import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { Env } from '../../../../worker'
import { runRoomOp } from '../rooms/core'
import { applyCounterIncrements } from '../rooms/insights-core'
import type { SchoolRoomRpc, InsightsRoomRpc } from '../rooms/rpc'
import { loadActor, listStudentIds } from '../middleware/actor'
import { issueToken, resolveToken } from '../middleware/tokens'
import { DISTRICT, SCHOOL, USER_IDS } from '../fixtures'
import { createKit } from '../routes/context'
import type { AltamiraRouteDeps } from '../routes/deps'
import { insightsRoutes } from '../routes/insights'
import { altamiraOnError, type AltamiraEnv } from '../middleware/auth'
import { insightsOps, schoolOps } from '../services/registry'
import { closeAll, insightsRoom, schoolRoom } from '../services/testing'

afterEach(closeAll)

function setup() {
  const school = schoolRoom(true)
  const insights = insightsRoom()
  const inc = (n: number, goalArea: string) =>
    Array.from({ length: n }, (_, i) => ({
      schoolId: SCHOOL.id, period: '2026-T1', studentKey: `${goalArea}-${i}`, goalArea,
      proficiencyLevel: null, label: null, reviewTimeliness: null, goalProgress: null, by: 1,
    }))
  applyCounterIncrements(insights, DISTRICT.id, [...inc(12, 'Reading'), ...inc(12, 'Math'), ...inc(2, 'Writing')] as never)
  const schoolRpc: SchoolRoomRpc = {
    run: async (op, args, actor) => structuredClone(runRoomOp(school, schoolOps, op, structuredClone(args), structuredClone(actor), { room: 'school', requireAudit: true })),
    loadActor: async (u, s) => loadActor(school, u, s),
    issueToken: async (i) => issueToken(school, i),
    resolveToken: async (h, k, n) => resolveToken(school, h, k, n),
    listStudentIds: async () => listStudentIds(school),
  }
  const insightsRpc: InsightsRoomRpc = {
    run: async (op, args, actor) => structuredClone(runRoomOp(insights, insightsOps, op, structuredClone(args), structuredClone(actor), { room: 'insights', requireAudit: false })),
    increment: async (d, i) => applyCounterIncrements(insights, d, i),
  }
  const deps = {
    rooms: { school: () => schoolRpc, insights: () => insightsRpc, student: () => { throw new Error('no student room') } },
    resolveUserId: async (req: Request) => req.headers.get('x-test-user'),
    schoolId: () => SCHOOL.id,
    districtId: () => DISTRICT.id,
    now: () => Date.parse('2026-11-09T17:00:00Z'),
  } as unknown as AltamiraRouteDeps
  const api = new Hono<AltamiraEnv>()
  insightsRoutes(api, createKit(deps))
  api.onError(altamiraOnError((err, c) => c.json({ error: { code: 'internal', message: String(err) } }, 500)))
  const get = async (user: string | null) => {
    const res = await api.request('/insights?groupBy=goalArea', { headers: user ? { 'x-test-user': user } : {} }, {} as Env)
    return { status: res.status, body: await res.json() as any }
  }
  return { get }
}

describe('GET /insights', () => {
  it('district lead gets aggregates with small groups suppressed', async () => {
    const { get } = setup()
    const res = await get(USER_IDS.districtLead)
    expect(res.status).toBe(200)
    expect(res.body.minGroupSize).toBe(10)
    const by = Object.fromEntries(res.body.groups.map((g: any) => [g.dims.goalArea, g]))
    expect(by.Reading).toMatchObject({ students: 12, suppressed: false })
    expect(by.Writing).toMatchObject({ students: null, count: null, suppressed: true })
    expect(JSON.stringify(res.body)).not.toMatch(/Writing-\d/)
  })
  it('teacher gets 403, anonymous 401', async () => {
    const { get } = setup()
    expect((await get(USER_IDS.teacher)).status).toBe(403)
    expect((await get(null)).status).toBe(401)
  })
})
