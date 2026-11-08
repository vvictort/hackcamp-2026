import type { Context, ErrorHandler, MiddlewareHandler } from 'hono'
import type { Env } from '../../../../worker'
import { can, type Actor, type Capability, type CanOptions, type DataFilter, type ActorRole } from '../contract/permissions'
import type { SchoolRoomRpc, StudentRoomRpc } from '../rooms/rpc'
import { errorResponse, HttpError, httpErrorFromDeny } from './errors'

export type Access = { studentId: string | null; role: ActorRole; filter: DataFilter }

export type AltamiraVariables = {
  actor: Actor
  /** Set by requireCapability: the role that passed and how repos must filter. */
  access: Access
}

export type AltamiraEnv = { Bindings: Env; Variables: AltamiraVariables }
export type AltamiraContext = Context<AltamiraEnv>

/** Everything the middleware reaches outside itself, so tests can pass fakes. */
export type AuthDeps = {
  /** The DeepSpace userId (resolveAuth in src/server/http-routes.ts), or null. */
  resolveUserId(req: Request, env: Env): Promise<string | null>
  schoolRoom(env: Env): Pick<SchoolRoomRpc, 'loadActor'>
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
   * request. The student id comes from the route param, else ?studentId=.
   * A refusal answers 403 and writes nothing.
   */
  const requireCapability = (capability: Capability, studentIdParam = 'id', options?: CapabilityOptions): Handler =>
    guarded(async (c, next) => {
      const actor = c.get('actor')
      if (!actor) throw new HttpError('unauthorized', 'Sign in required.')
      const studentId = c.req.param(studentIdParam) ?? c.req.query('studentId') ?? null
      const opts = options ? await options(c) : {}
      const result = can(actor, capability, studentId, { ...opts, now: opts.now ?? deps.now() })
      if (!result.allowed) throw httpErrorFromDeny(result)
      c.set('access', { studentId, role: result.role, filter: result.filter })
      await next()
    })

  return { altamiraAuth, requireCapability }
}
