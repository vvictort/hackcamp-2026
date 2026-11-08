import type { MiddlewareHandler } from 'hono'
import type { z } from 'zod'
import type { Env } from '../../../../worker'
import { createAi, type AiFunctions } from '../ai/functions'
import type { Roster, RosterStudent } from '../ai/deidentify'
import { createFixtureSummaryProvider, createSummaryAi, summaryProviderFromEnv, type SummaryAi } from '../ai/summaries'
import type { AltamyraRoomRpc, RoomOp } from '../contract/ops'
import { can, type Actor, type CanOptions, type Capability } from '../contract/permissions'
import { createAltamyraMiddleware, type AltamyraContext, type AltamyraEnv } from '../middleware/auth'
import { errorResponse, HttpError, httpErrorFromDeny, unwrapOp } from '../middleware/errors'
import { deidSchoolRoster, deidStudentNames } from '../services/deid'
import { schoolDate } from '../services/student-common'
import type { AltamyraRouteDeps } from './deps'

/** Shared plumbing for every route module: middleware, room calls, validation. */
export type Kit = ReturnType<typeof createKit>

const issues = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.map(String).join('.') || 'body'}: ${i.message}`).join('; ')

export function createKit(deps: AltamyraRouteDeps) {
  const mw = createAltamyraMiddleware({
    resolveUserId: deps.resolveUserId,
    schoolRoom: (env) => deps.rooms.school(env),
    studentRoom: (env, studentId) => deps.rooms.student(env, studentId),
    schoolId: deps.schoolId,
    now: deps.now,
  })
  /** Routes whose path has no student id take ?studentId= (contract StudentRefQuery). 400 without it. */
  const studentRef: MiddlewareHandler<AltamyraEnv> = async (c, next) => {
    if (!c.req.query('studentId')) return errorResponse(new HttpError('bad_request', 'studentId query parameter is required')) ?? undefined
    await next()
  }
  return { deps, mw, signedIn: mw.altamyraAuth(), studentRef, req: (c: AltamyraContext) => new Req(deps, c) }
}

/** One request: the caller, its clock, typed room calls and contract validation. */
export class Req {
  constructor(
    readonly deps: AltamyraRouteDeps,
    readonly c: AltamyraContext,
  ) {}

  get env(): Env {
    return this.c.env
  }

  get actor(): Actor {
    return this.c.get('actor')
  }

  now(): number {
    return this.deps.now()
  }

  nowIso(): string {
    return new Date(this.deps.now()).toISOString()
  }

  /** Today's date at the school (BC schools: America/Vancouver), YYYY-MM-DD. */
  today(): string {
    return schoolDate(this.nowIso())
  }

  param(name: string): string {
    const v = this.c.req.param(name)
    if (!v) throw new HttpError('bad_request', `missing path parameter ${name}`)
    return v
  }

  /** The student a route without :id acts on, from ?studentId= (checked by requireCapability). */
  studentRef(): string {
    const id = this.c.req.query('studentId')
    if (!id) throw new HttpError('bad_request', 'studentId query parameter is required')
    return id
  }

  async body<S extends z.ZodType>(schema: S): Promise<z.output<S>> {
    // An empty body counts as {} so routes whose fields are all optional accept a bare POST.
    let raw: unknown = {}
    const text = await this.c.req.text()
    if (text.trim()) {
      try {
        raw = JSON.parse(text)
      } catch {
        throw new HttpError('bad_request', 'request body must be JSON')
      }
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new HttpError('bad_request', issues(parsed.error))
    return parsed.data
  }

  query<S extends z.ZodType>(schema: S, raw: Record<string, unknown> = this.c.req.query()): z.output<S> {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new HttpError('bad_request', issues(parsed.error))
    return parsed.data
  }

  /** NFR Security: the permission matrix, checked server-side. 403, or 410 for an expired link. */
  allow(capability: Capability, studentId: string | null, opts: CanOptions = {}): void {
    const result = can(this.actor, capability, studentId, { now: this.now(), ...opts })
    if (!result.allowed) throw httpErrorFromDeny(result)
  }

  can(capability: Capability, studentId: string | null, opts: CanOptions = {}): boolean {
    return can(this.actor, capability, studentId, { now: this.now(), ...opts }).allowed
  }

  /** Student ids the caller holds any staff role for (parents excluded). */
  staffStudentIds(): string[] {
    return Object.keys(this.actor.studentRoles)
  }

  private async run<A, R>(room: AltamyraRoomRpc, op: RoomOp<A, R>, args: Record<string, unknown>): Promise<R> {
    // Every op takes an optional `now`; ops that do not declare it drop the key when parsing args.
    return unwrapOp(await room.run(op.name, { now: this.nowIso(), ...args }, this.actor)) as R
  }

  student<A, R>(studentId: string, op: RoomOp<A, R>, args: Record<string, unknown> = {}): Promise<R> {
    return this.run(this.deps.rooms.student(this.env, studentId), op, { ...args, studentId })
  }

  school<A, R>(op: RoomOp<A, R>, args: Record<string, unknown> = {}): Promise<R> {
    return this.run(this.deps.rooms.school(this.env), op, args)
  }

  insights<A, R>(op: RoomOp<A, R>, args: Record<string, unknown> = {}): Promise<R> {
    return this.run(this.deps.rooms.insights(this.env), op, args)
  }

  /**
   * AI functions on de-identified input (design doc "AI module"; PRD NFR
   * Privacy). Called outside any room transaction. The roster is built for
   * this request from real data: every staff and family name in the school
   * room, and the names in each listed student's IEP versions. A student whose
   * token appears in an input but who is not listed here makes the call fail closed.
   */
  async ai(studentIds: readonly string[]): Promise<AiFunctions> {
    return createAi({ provider: this.deps.aiProvider(this.env), roster: await this.deidRoster(studentIds) })
  }

  /**
   * The summary drafting AI (Gemini via AI Studio, fixture without a key), on the
   * same de-identification roster. `fixture` forces the deterministic provider (the fallback when Gemini fails).
   */
  async summaryAi(studentIds: readonly string[], fixture = false): Promise<SummaryAi> {
    const provider = fixture ? createFixtureSummaryProvider() : summaryProviderFromEnv(this.env as unknown as Parameters<typeof summaryProviderFromEnv>[0])
    return createSummaryAi({ provider, roster: await this.deidRoster(studentIds) })
  }

  private async deidRoster(studentIds: readonly string[]): Promise<Roster> {
    const base = await this.deps.roster(this.env)
    const ids = [...new Set(studentIds)]
    const school = await this.school(deidSchoolRoster, { studentIds: ids })
    const students: RosterStudent[] = [...base.students]
    for (const id of ids) {
      const token = school.tokens[id]
      if (!token) continue
      const { names } = await this.student(id, deidStudentNames)
      students.push(...names.map((n) => ({ token, ...n })))
    }
    return { students, people: [...base.people, ...school.people.map((displayName) => ({ displayName }))], schools: base.schools }
  }

  /** Seed for the random review sample: server-generated, never request input (PRD 1B "Confidence"). */
  sampleSeed(): string {
    return this.deps.sampleSeed?.() ?? crypto.randomUUID()
  }

  /** Validates the response against the contract before it leaves the server. */
  json<S extends z.ZodType>(schema: S, value: z.input<S>, status = 200): Response {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error(`response does not match the contract: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`)
    return this.c.newResponse(JSON.stringify(parsed.data), status as 200, { 'Content-Type': 'application/json' })
  }
}
