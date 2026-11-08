// Worker wiring for the Altamira middleware. Tests import ./auth with fake deps instead.
import { resolveAuth } from '../../http-routes'
import { altamiraSchoolId, schoolRoom, studentRoom } from '../rooms/stubs'
import { createAltamiraMiddleware, type AuthDeps } from './auth'

export const defaultAuthDeps: AuthDeps = {
  resolveUserId: async (req, env) => (await resolveAuth(req, env))?.userId ?? null,
  schoolRoom: (env) => schoolRoom(env),
  studentRoom: (env, studentId) => studentRoom(env, studentId),
  schoolId: (env) => altamiraSchoolId(env),
  now: () => Date.now(),
}

export const { altamiraAuth, requireCapability } = createAltamiraMiddleware(defaultAuthDeps)

export { altamiraOnError, type AltamiraContext, type AltamiraEnv, type AltamiraVariables } from './auth'
export { errorResponse, HttpError, httpErrorFromDeny, unwrapOp } from './errors'
export { isAltamiraRoomId } from './room-guard'
