import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../../../../worker'
import type { ConsentKind } from '../contract/enums'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateSchool } from '../db/schema/school'
import { SCHOOL, seedSchool, STUDENT_IDS, USER_IDS } from '../fixtures'
import { loadActor } from './actor'
import { createAltamyraMiddleware, type AltamyraEnv, type AuthDeps } from './auth'

const NOW = Date.parse('2026-11-07T18:00:00.000Z')
const env = {} as Env
const sql = createNodeSqlExecutor()

const school = { loadActor: async (userId: string, schoolId: string) => loadActor(sql, userId, schoolId) }
const studentRoom = () => ({ hasConsent: async (_kind: ConsentKind) => false })

const deps: AuthDeps = {
  // The fake "JWT" is the user id itself.
  resolveUserId: async (req) => req.headers.get('Authorization')?.replace('Bearer ', '') || null,
  schoolRoom: () => school,
  studentRoom,
  schoolId: () => SCHOOL.id,
  now: () => NOW,
}

const { altamyraAuth, requireCapability } = createAltamyraMiddleware(deps)

const app = new Hono<AltamyraEnv>()
app.use('/v1/*', altamyraAuth())
app.get('/v1/students/:id/timeline', requireCapability('progress.view'), (c) => c.json(c.get('access')))
app.put('/v1/students/:id/iep', requireCapability('iep.import'), (c) => c.json({ ok: true }))
app.get('/v1/family/:id/summaries', requireCapability('summary.view'), (c) => c.json(c.get('access')))
app.get('/v1/admin/schools/:id/memberships', requireCapability('membership.manage', 'none', (c) => ({ schoolId: c.req.param('id') })), (c) => c.json({ ok: true }))

const bearer = (userId: string) => ({ headers: { Authorization: `Bearer ${userId}` } })
const get = (path: string, init?: RequestInit) => app.request(path, init, env)

beforeAll(() => {
  migrateSchool(sql)
  seedSchool(sql)
})
afterAll(() => sql.close())

describe('altamyraAuth and requireCapability', () => {
  it('401 without a signed-in user', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in required.' } })
  })

  it('passes the case manager', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`, bearer(USER_IDS.caseManager))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ role: 'case_manager', filter: 'all' })
  })

  it('refuses a parent on staff routes but gives approved-only summaries for their own child', async () => {
    expect((await get(`/v1/students/${STUDENT_IDS.kai}/timeline`, bearer(USER_IDS.parentKai))).status).toBe(403)
    const own = await get(`/v1/family/${STUDENT_IDS.kai}/summaries`, bearer(USER_IDS.parentKai))
    expect(await own.json()).toMatchObject({ role: 'parent', filter: 'approved_only' })
    expect((await get(`/v1/family/${STUDENT_IDS.amara}/summaries`, bearer(USER_IDS.parentKai))).status).toBe(403)
  })

  it('403 for a teacher importing the IEP', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/iep`, { method: 'PUT', ...bearer(USER_IDS.teacher) })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('forbidden')
  })

  it('403 for a district lead on any student', async () => {
    const res = await get(`/v1/students/${STUDENT_IDS.kai}/timeline`, bearer(USER_IDS.districtLead))
    expect(res.status).toBe(403)
  })

  it('only the school administrator manages memberships of their school', async () => {
    const path = `/v1/admin/schools/${SCHOOL.id}/memberships`
    expect((await get(path, bearer(USER_IDS.schoolAdmin))).status).toBe(200)
    expect((await get(path, bearer(USER_IDS.caseManager))).status).toBe(403)
    expect((await get(`/v1/admin/schools/other/memberships`, bearer(USER_IDS.schoolAdmin))).status).toBe(403)
  })
})
