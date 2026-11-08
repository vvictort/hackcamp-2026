// Worker wiring for the Altamyra middleware. Tests import ./auth with fake deps instead.
import { resolveAuth } from '../../http-routes'
import { altamyraSchoolId, schoolRoom, studentRoom } from '../rooms/stubs'
import { createAltamyraMiddleware, type AuthDeps } from './auth'

export const defaultAuthDeps: AuthDeps = {
  resolveUserId: async (req, env) => (await resolveAuth(req, env))?.userId ?? null,
  schoolRoom: (env) => schoolRoom(env),
  studentRoom: (env, studentId) => studentRoom(env, studentId),
  schoolId: (env) => altamyraSchoolId(env),
  now: () => Date.now(),
}

export const { altamyraAuth, requireCapability } = createAltamyraMiddleware(defaultAuthDeps)

export { altamyraOnError, type AltamyraContext, type AltamyraEnv, type AltamyraVariables } from './auth'
export { errorResponse, HttpError, httpErrorFromDeny, unwrapOp } from './errors'
export { isAltamyraRoomId } from './room-guard'
