import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../../../../worker'
import type { ConsentKind } from '../contract/enums'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateSchool } from '../db/schema/school'
import { SCHOOL, seedSchool, STUDENT_IDS, USER_IDS } from '../fixtures'
import { loadActor } from './actor'
import { createAltamiraMiddleware, SESSION_HEADER, type AltamiraEnv, type AuthDeps } from './auth'
import { HttpError } from './errors'
import { createTodayLink, startStudentSession, STUDENT_SESSION_TTL_MS, type SessionDeps } from './session'
import { hashToken, issueToken, resolveToken } from './tokens'

const NOW = Date.parse('2026-11-07T18:00:00.000Z')
const env = {} as Env
const sql = createNodeSqlExecutor()
let clock = NOW

/** Consents per student (fictional): Kai has student mode, Amara has none. */
const consents: Record<string, ConsentKind[]> = { [STUDENT_IDS.kai]: ['student_mode'], [STUDENT_IDS.amara]: [] }

const school = {
  loadActor: async (userId: string, schoolId: string) => loadActor(sql, userId, schoolId),
  resolveToken: async (hash: string, kind: 'today_view' | 'student_session', now: number) => resolveToken(sql, hash, kind, now),
  issueToken: async (input: Parameters<typeof issueToken>[1]) => issueToken(sql, input),
}
const studentRoom = (_env: Env, studentId: string) => ({
  hasConsent: async (kind: ConsentKind) => (consents[studentId] ?? []).includes(kind),
})

const deps: AuthDeps = {
  // The fake "JWT" is the user id itself.
  resolveUserId: async (req) => req.headers.get('Authorization')?.replace('Bearer ', '') || null,
  schoolRoom: () => school,
  studentRoom,
  schoolId: () => SCHOOL.id,
  now: () => clock,
}
const sessionDeps: SessionDeps = { schoolRoom: () => school, studentRoom, now: () => clock }

const { altamiraAuth, requireCapability, todayViewAuth, studentSessionAuth } = createAltamiraMiddleware(deps)

const app = new Hono<AltamiraEnv>()
app.use('/v1/students/*', altamiraAuth())
app.get('/v1/students/:id/timeline', requireCapability('progress.view'), (c) => c.json(c.get('access')))
app.put('/v1/students/:id/iep', requireCapability('iep.write'), (c) => c.json({ ok: true }))
app.get('/v1/today/:token', todayViewAuth(), requireCapability('iep.view', 'none'), (c) =>
  c.json({ studentId: c.get('shareToken').studentId, filter: c.get('access').filter }),
)
app.get('/v1/sessions/:sid/next', studentSessionAuth(), (c) => c.json({ studentId: c.get('actor').session?.studentId }))

const bearer = (userId: string) => ({ headers: { Authorization: `Bearer ${userId}` } })
const get = (path: string, init?: RequestInit) => app.request(path, init, env)

beforeAll(() => {
  migrateSchool(sql)
  seedSchool(sql)
})
afterAll(() => sql.close())

async function todayToken(expiresAt: string) {
  const raw = `fictional-today-${expiresAt}`
  await school.issueToken({ kind: 'today_view', studentId: STUDENT_IDS.kai, createdBy: USER_IDS.teacher, tokenHash: await hashToken(raw), expiresAt })
  return raw
}

describe('altamiraAuth and requireCapability', () => {
  it('401 without a signed-in user', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in required.' } })
  })

  it('passes the case manager with the "all" filter', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`, bearer(USER_IDS.caseManager))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ role: 'case_manager', filter: 'all' })
  })

  it('gives a parent the confirmed-only filter for their child, 403 for another child', async () => {
    const own = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`, bearer(USER_IDS.parentKai))
    expect(await own.json()).toMatchObject({ role: 'parent', filter: 'confirmed_only' })
    const other = await get(`/v1/students/${STUDENT_IDS.amara}/timeline`, bearer(USER_IDS.parentKai))
    expect(other.status).toBe(403)
  })

  it('403 for a teacher writing the IEP, naming the propose capability', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/iep`, { method: 'PUT', ...bearer(USER_IDS.teacher) })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('forbidden')
    expect(body.error.message).toContain('iep.propose')
  })

  it('403 for a district lead on any student', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`, bearer(USER_IDS.districtLead))
    expect(res.status).toBe(403)
  })
})

describe('todayViewAuth', () => {
  it('passes a live link with the today_view filter', async () => {
    const raw = await todayToken('2026-11-08T06:00:00.000Z')
    const res = await get(`/v1/today/${raw}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ studentId: STUDENT_IDS.kai, filter: 'today_view' })
  })

  it('410 for an expired link, 404 for an unknown one', async () => {
    const raw = await todayToken('2026-11-07T17:00:00.000Z')
    const gone = await get(`/v1/today/${raw}`)
    expect(gone.status).toBe(410)
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe('gone')
    expect((await get('/v1/today/never-issued')).status).toBe(404)
  })

  it('410 when the link expires between issue and use', async () => {
    const raw = await todayToken('2026-11-07T18:30:00.000Z')
    expect((await get(`/v1/today/${raw}`)).status).toBe(200)
    clock = NOW + 60 * 60 * 1000
    expect((await get(`/v1/today/${raw}`)).status).toBe(410)
    clock = NOW
  })
})

describe('student sessions', () => {
  it('a teacher starts a session for a consented student; the device uses it until timeout', async () => {
    const teacher = loadActor(sql, USER_IDS.teacher, SCHOOL.id)
    const started = await startStudentSession(sessionDeps, env, teacher, STUDENT_IDS.kai)
    expect(Date.parse(started.expiresAt) - NOW).toBe(STUDENT_SESSION_TTL_MS)

    const ok = await get(`/v1/sessions/${started.sessionId}/next`, { headers: { [SESSION_HEADER]: started.token } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ studentId: STUDENT_IDS.kai })

    const otherSid = await get('/v1/sessions/someone-else/next', { headers: { [SESSION_HEADER]: started.token } })
    expect(otherSid.status).toBe(403)

    clock = NOW + STUDENT_SESSION_TTL_MS
    const timedOut = await get(`/v1/sessions/${started.sessionId}/next`, { headers: { [SESSION_HEADER]: started.token } })
    expect(timedOut.status).toBe(410)
    clock = NOW
  })

  it('401 without a session token', async () => {
    expect((await get('/v1/sessions/x/next')).status).toBe(401)
  })

  it('403 once consent is revoked mid-session', async () => {
    const teacher = loadActor(sql, USER_IDS.teacher, SCHOOL.id)
    const started = await startStudentSession(sessionDeps, env, teacher, STUDENT_IDS.kai)
    consents[STUDENT_IDS.kai] = []
    const res = await get(`/v1/sessions/${started.sessionId}/next`, { headers: { [SESSION_HEADER]: started.token } })
    expect(res.status).toBe(403)
    consents[STUDENT_IDS.kai] = ['student_mode']
  })

  it('refuses to start without consent, or for a parent or case manager', async () => {
    const teacher = loadActor(sql, USER_IDS.teacher, SCHOOL.id)
    await expect(startStudentSession(sessionDeps, env, teacher, STUDENT_IDS.amara)).rejects.toThrow(HttpError)
    const parent = loadActor(sql, USER_IDS.parentKai, SCHOOL.id)
    await expect(startStudentSession(sessionDeps, env, parent, STUDENT_IDS.kai)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('createTodayLink', () => {
  it('lets a teacher create a link and refuses a parent', async () => {
    const teacher = loadActor(sql, USER_IDS.teacher, SCHOOL.id)
    const link = await createTodayLink(sessionDeps, env, teacher, STUDENT_IDS.kai, 12)
    expect(Date.parse(link.expiresAt) - NOW).toBe(12 * 60 * 60 * 1000)
    expect((await get(`/v1/today/${link.token}`)).status).toBe(200)

    const parent = loadActor(sql, USER_IDS.parentKai, SCHOOL.id)
    await expect(createTodayLink(sessionDeps, env, parent, STUDENT_IDS.kai, 12)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
