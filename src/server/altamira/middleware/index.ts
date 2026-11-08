// Worker wiring for the Altamira middleware. Tests import ./auth with fake deps instead.
import type { Env } from '../../../../worker'
import { resolveAuth } from '../../http-routes'
import { altamiraSchoolId, schoolRoom, studentRoom } from '../rooms/stubs'
import { createAltamiraMiddleware, type AuthDeps } from './auth'
import { createTodayLink, startStudentSession, type SessionDeps } from './session'
import type { Actor } from '../contract/permissions'

export const defaultAuthDeps: AuthDeps = {
  resolveUserId: async (req, env) => (await resolveAuth(req, env))?.userId ?? null,
  schoolRoom: (env) => schoolRoom(env),
  studentRoom: (env, studentId) => studentRoom(env, studentId),
  schoolId: (env) => altamiraSchoolId(env),
  now: () => Date.now(),
}

const sessionDeps: SessionDeps = {
  schoolRoom: (env) => schoolRoom(env),
  studentRoom: (env, studentId) => studentRoom(env, studentId),
  now: () => Date.now(),
}

export const { altamiraAuth, requireCapability, todayViewAuth, studentSessionAuth } =
  createAltamiraMiddleware(defaultAuthDeps)

export const startSession = (env: Env, actor: Actor, studentId: string) =>
  startStudentSession(sessionDeps, env, actor, studentId)

export const issueTodayLink = (env: Env, actor: Actor, studentId: string, ttlHours: number) =>
  createTodayLink(sessionDeps, env, actor, studentId, ttlHours)

export { altamiraOnError, SESSION_HEADER, type AltamiraContext, type AltamiraEnv, type AltamiraVariables } from './auth'
export { errorResponse, HttpError, httpErrorFromDeny, unwrapOp } from './errors'
export { isAltamiraRoomId } from './room-guard'
export { STUDENT_SESSION_TTL_MS } from './session'
