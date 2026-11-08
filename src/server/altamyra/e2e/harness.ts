import { Hono } from 'hono'
import type { Env } from '../../../../worker'
import { fixtureRoster } from '../ai/fixture-data'
import { unitInterval } from '../ai/hash'
import { createFixtureProvider } from '../ai/providers/fixture'
import { createFixtureSummaryProvider } from '../ai/summaries-provider'
import { AI_SCHEMAS, type AiFunctionName, type AiProvider } from '../contract/ai'
import type { AltamyraRoomRpc, OpRegistry, RoomName, SqlExecutor } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import { DISTRICT, SCHOOL, STUDENT_IDS, type FixtureStudentKey } from '../fixtures'
import { listStudentIds, loadActor } from '../middleware/actor'
import { runRoomOp } from '../rooms/core'
import { applyCounterIncrements } from '../rooms/insights-core'
import type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from '../rooms/rpc'
import { hasActiveConsent } from '../rooms/student-core'
import { insightsOps, schoolOps, studentOps } from '../services/registry'
import { insightsRoom, schoolRoom, studentRoom } from './testing'
import { createAltamyraApi } from '../routes/app'
import { AI_REVIEW_SAMPLE_RATE } from '../routes/capture'
import type { AltamyraRouteDeps } from '../routes/deps'

/**
 * End-to-end harness: the real /api/v1 sub-app over in-memory rooms on
 * node:sqlite running the real ops, with the fictional fixtures. Values
 * cross the room boundary through structuredClone, as Durable Object RPC does.
 */

const AI_FUNCTIONS = Object.keys(AI_SCHEMAS) as AiFunctionName[]

const KEY_BY_ID: Record<string, FixtureStudentKey> = Object.fromEntries(
  Object.entries(STUDENT_IDS).map(([key, id]) => [id, key as FixtureStudentKey]),
)

/** Monday 2026-11-09, 09:00 in Vancouver. */
export const START = Date.parse('2026-11-09T17:00:00.000Z')

export type HarnessOptions = {
  /** Seed the fixtures into the rooms (default true). False leaves them empty for POST /dev/seed. */
  seed?: boolean
  devSeed?: boolean
  /** Every confident AI score falls in the random review sample (default false: none does). */
  sampleEverything?: boolean
  /** Replace single AI functions; the rest come from the fixture provider. */
  ai?: Partial<Omit<AiProvider, 'name'>>
}

export type Call = { status: number; body: any }

export function createHarness(options: HarnessOptions = {}) {
  const seed = options.seed ?? true
  const clock = { now: START }
  const school = schoolRoom(seed)
  const insights = insightsRoom()
  const students = new Map<string, SqlExecutor>()
  const deletedFiles: string[] = []
  let seeds = 0
  const errors: unknown[] = []

  const studentSql = (id: string): SqlExecutor => {
    let sql = students.get(id)
    if (!sql) {
      sql = studentRoom(seed ? KEY_BY_ID[id] : undefined)
      students.set(id, sql)
    }
    return sql
  }

  const runner = (sql: SqlExecutor, registry: OpRegistry, room: RoomName): AltamyraRoomRpc['run'] =>
    async (opName, args, actor: Actor) =>
      structuredClone(runRoomOp(sql, registry, opName, structuredClone(args), structuredClone(actor), { room, requireAudit: room !== 'insights' }))

  const schoolRpc: SchoolRoomRpc = {
    run: runner(school, schoolOps, 'school'),
    loadActor: async (userId, schoolId) => loadActor(school, userId, schoolId),
    listStudentIds: async () => listStudentIds(school),
  }
  const insightsRpc: InsightsRoomRpc = {
    run: runner(insights, insightsOps, 'insights'),
    increment: async (districtId, increments) => applyCounterIncrements(insights, districtId, increments),
  }
  const studentRpc = (id: string): StudentRoomRpc => {
    const sql = studentSql(id)
    return { run: runner(sql, studentOps, 'student'), hasConsent: async (kind) => hasActiveConsent(sql, kind) }
  }

  // Counts every provider call (after de-identification) so tests can assert "one analysis per lesson".
  const base = createFixtureProvider()
  const aiCalls = Object.fromEntries(AI_FUNCTIONS.map((f) => [f, 0])) as Record<AiFunctionName, number>
  const aiRequests: { fn: AiFunctionName; input: unknown }[] = []
  const provider = {} as AiProvider
  for (const fn of AI_FUNCTIONS) {
    const impl = (options.ai?.[fn] ?? base[fn]) as (input: unknown) => Promise<unknown>
    ;(provider as unknown as Record<string, unknown>)[fn] = async (input: unknown) => {
      aiCalls[fn]++
      aiRequests.push({ fn, input })
      return impl(input)
    }
  }

  const deps: AltamyraRouteDeps = {
    rooms: { student: (_env, id) => studentRpc(id), school: () => schoolRpc, insights: () => insightsRpc },
    resolveUserId: async (req) => req.headers.get('x-test-user'),
    aiProvider: () => provider,
    summaryProvider: () => createFixtureSummaryProvider(),
    roster: () => fixtureRoster(),
    // Reproducible server-side seeds that never fall in the random review sample, unless a test asks for one.
    sampleSeed: () => {
      let s = `harness-seed-${++seeds}`
      while ((unitInterval(s, 'sample') < AI_REVIEW_SAMPLE_RATE) !== (options.sampleEverything ?? false)) s = `harness-seed-${++seeds}`
      return s
    },
    schoolId: () => SCHOOL.id,
    districtId: () => DISTRICT.id,
    devSeedEnabled: () => options.devSeed ?? false,
    deleteFile: async (_env, fileKey) => {
      deletedFiles.push(fileKey)
    },
    // Unexpected errors still answer a generic 500; tests can inspect them here.
    fallbackError: (err, c) => {
      errors.push(err)
      return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
    },
    now: () => clock.now,
  }

  const app = new Hono()
  app.route('/api/v1', createAltamyraApi(deps) as unknown as Hono)
  const env = {} as Env

  async function call(user: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Call> {
    const res = await app.request(
      `/api/v1${path}`,
      {
        method,
        headers: {
          ...(user ? { 'x-test-user': user } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      env,
    )
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  return {
    call,
    get: (user: string | null, path: string, headers?: Record<string, string>) => call(user, 'GET', path, undefined, headers),
    post: (user: string | null, path: string, body: unknown = {}, headers?: Record<string, string>) => call(user, 'POST', path, body, headers),
    clock,
    school,
    studentSql,
    aiCalls,
    aiRequests,
    deletedFiles,
    errors,
  }
}

export type Harness = ReturnType<typeof createHarness>
