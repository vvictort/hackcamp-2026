import type { Context, ErrorHandler, MiddlewareHandler } from 'hono'
import type { Env } from '../../../../worker'
import { can, sessionActor, type Actor, type Capability, type CanOptions, type DataFilter, type ActorRole } from '../contract/permissions'
import type { SchoolRoomRpc, StudentRoomRpc } from '../rooms/rpc'
import { errorResponse, HttpError, httpErrorFromDeny } from './errors'
import { hashToken, type ResolvedToken } from './tokens'

/** Header a student-mode device sends with its session token. */
export const SESSION_HEADER = 'X-Altamira-Session'

export type Access = { studentId: string | null; role: ActorRole; filter: DataFilter }

export type AltamiraVariables = {
  actor: Actor
  /** Set by requireCapability: the role that passed and how repos must filter. */
  access: Access
  /** Set by todayViewAuth / studentSessionAuth. */
  shareToken: ResolvedToken
}

export type AltamiraEnv = { Bindings: Env; Variables: AltamiraVariables }
export type AltamiraContext = Context<AltamiraEnv>

/** Everything the middleware reaches outside itself, so tests can pass fakes. */
export type AuthDeps = {
  /** The DeepSpace userId (resolveAuth in src/server/http-routes.ts), or null. */
  resolveUserId(req: Request, env: Env): Promise<string | null>
  schoolRoom(env: Env): Pick<SchoolRoomRpc, 'loadActor' | 'resolveToken'>
  studentRoom(env: Env, studentId: string): Pick<StudentRoomRpc, 'hasConsent'>
  schoolId(env: Env): string
  now(): number
}

type Handler = MiddlewareHandler<AltamiraEnv>

/** Runs fn; an Altamira error becomes its JSON response, anything else propagates. */
const guarded =
  (fn: (c: AltamiraContext, next: () => Promise<void>) => Promise<void>): Handler =>
  async (c, next) => {
    try {
      await fn(c, next)
    } catch (err) {
      const res = errorResponse(err)
      if (!res) throw err
      return res
    }
  }

/** onError for the Altamira sub-app: contract JSON for our errors, `fallback` for the rest. */
export const altamiraOnError =
  (fallback: ErrorHandler<AltamiraEnv>): ErrorHandler<AltamiraEnv> =>
  (err, c) =>
    errorResponse(err) ?? fallback(err, c)

export type CapabilityOptions = (c: AltamiraContext) => CanOptions | Promise<CanOptions>

export function createAltamiraMiddleware(deps: AuthDeps) {
  /** DeepSpace sign-in, then the caller's roles from the school room. 401 without a user. */
  const altamiraAuth = (): Handler =>
    guarded(async (c, next) => {
      const userId = await deps.resolveUserId(c.req.raw, c.env)
      if (!userId) throw new HttpError('unauthorized', 'Sign in required.')
      c.set('actor', await deps.schoolRoom(c.env).loadActor(userId, deps.schoolId(c.env)))
      await next()
    })

  /**
   * NFR Security: role and per-student scope checked server-side on every
   * request. The student id comes from the route param, else ?studentId=,
   * else the session's own student.
   * A refusal answers 403 (410 for an expired link) and writes nothing.
   */
  const requireCapability = (capability: Capability, studentIdParam = 'id', options?: CapabilityOptions): Handler =>
    guarded(async (c, next) => {
      const actor = c.get('actor')
      if (!actor) throw new HttpError('unauthorized', 'Sign in required.')
      // Session principals (Today View, student mode) default to their own student.
      const studentId = c.req.param(studentIdParam) ?? c.req.query('studentId') ?? actor.session?.studentId ?? null
      const opts = options ? await options(c) : {}
      const result = can(actor, capability, studentId, { ...opts, now: opts.now ?? deps.now() })
      if (!result.allowed) throw httpErrorFromDeny(result)
      c.set('access', { studentId, role: result.role, filter: result.filter })
      await next()
    })

  /** Today View (GET /today/:token, no login). Unknown token 404; expired or revoked 410. */
  const todayViewAuth = (tokenParam = 'token'): Handler =>
    guarded(async (c, next) => {
      const raw = c.req.param(tokenParam)
      if (!raw) throw new HttpError('not_found', 'Link not found.')
      const lookup = await deps.schoolRoom(c.env).resolveToken(await hashToken(raw), 'today_view', deps.now())
      if (!lookup.ok) {
        throw lookup.reason === 'gone'
          ? new HttpError('gone', 'This link has expired.')
          : new HttpError('not_found', 'Link not found.')
      }
      const { token } = lookup
      c.set('shareToken', token)
      c.set(
        'actor',
        sessionActor({ kind: 'substitute_link', studentId: token.studentId, tokenId: token.id, expiresAt: token.expiresAt, startedBy: null }),
      )
      await next()
    })

  /**
   * Student-mode routes (/sessions/:sid/*). The device sends the session token
   * in SESSION_HEADER. PRD NFR Privacy: sessions are started by an adult, time
   * out automatically (410 after expiry) and need active student_mode consent.
   */
  const studentSessionAuth = (sessionParam = 'sid'): Handler =>
    guarded(async (c, next) => {
      const raw = c.req.header(SESSION_HEADER)
      if (!raw) throw new HttpError('unauthorized', 'Student session required.')
      const lookup = await deps.schoolRoom(c.env).resolveToken(await hashToken(raw), 'student_session', deps.now())
      if (!lookup.ok) {
        throw lookup.reason === 'gone'
          ? new HttpError('gone', 'This session has ended.')
          : new HttpError('unauthorized', 'Student session required.')
      }
      const { token } = lookup
      const sid = c.req.param(sessionParam)
      if (sid !== undefined && sid !== token.id) throw new HttpError('forbidden', 'Not this session.')
      if (!(await deps.studentRoom(c.env, token.studentId).hasConsent('student_mode'))) {
        throw new HttpError('forbidden', 'Student mode needs recorded parental consent.')
      }
      c.set('shareToken', token)
      c.set(
        'actor',
        sessionActor({
          kind: 'student_session',
          studentId: token.studentId,
          tokenId: token.id,
          expiresAt: token.expiresAt,
          startedBy: token.createdBy,
        }),
      )
      await next()
    })

  return { altamiraAuth, requireCapability, todayViewAuth, studentSessionAuth }
}
