import type { Env } from '../../../../worker'
import type { z } from 'zod'
import type { SessionCreateResponse, TodayLinkResponse } from '../contract/api'
import { can, rolesFor, type Actor } from '../contract/permissions'
import type { SchoolRoomRpc, StudentRoomRpc } from '../rooms/rpc'
import { HttpError, httpErrorFromDeny } from './errors'
import { mintToken } from './tokens'

/** PRD NFR Privacy: student-mode sessions time out automatically. The PRD gives no length. */
export const STUDENT_SESSION_TTL_MS = 30 * 60 * 1000

export type SessionDeps = {
  schoolRoom(env: Env): Pick<SchoolRoomRpc, 'issueToken'>
  studentRoom(env: Env, studentId: string): Pick<StudentRoomRpc, 'hasConsent'>
  now(): number
}

/** PRD "Roles and modes": student mode is started by a teacher or EA for one student. */
export function canStartStudentSession(actor: Actor, studentId: string, now: number): boolean {
  if (actor.session) return false
  const roles = rolesFor(actor, studentId, now)
  return roles !== 'expired' && (roles.includes('teacher') || roles.includes('ea'))
}

/** POST /students/:id/sessions. Needs an active student_mode consent (PRD NFR Privacy). */
export async function startStudentSession(
  deps: SessionDeps,
  env: Env,
  actor: Actor,
  studentId: string,
): Promise<z.infer<typeof SessionCreateResponse>> {
  const now = deps.now()
  if (!canStartStudentSession(actor, studentId, now)) {
    throw new HttpError('forbidden', 'Only a teacher or EA of this student can start student mode.')
  }
  if (!(await deps.studentRoom(env, studentId).hasConsent('student_mode'))) {
    throw new HttpError('forbidden', 'Student mode needs recorded parental consent.')
  }
  const { token, tokenHash } = await mintToken()
  const expiresAt = new Date(now + STUDENT_SESSION_TTL_MS).toISOString()
  const sessionId = await deps.schoolRoom(env).issueToken({
    kind: 'student_session',
    studentId,
    createdBy: actor.userId,
    tokenHash,
    expiresAt,
    createdAt: new Date(now).toISOString(),
  })
  return { sessionId, token, expiresAt }
}

/** POST /students/:id/today-links (capability today_link.create). The raw token is returned once. */
export async function createTodayLink(
  deps: Omit<SessionDeps, 'studentRoom'>,
  env: Env,
  actor: Actor,
  studentId: string,
  ttlHours: number,
): Promise<z.infer<typeof TodayLinkResponse>> {
  const now = deps.now()
  const allowed = can(actor, 'today_link.create', studentId, { now })
  if (!allowed.allowed) throw httpErrorFromDeny(allowed)
  const { token, tokenHash } = await mintToken()
  const expiresAt = new Date(now + ttlHours * 60 * 60 * 1000).toISOString()
  await deps.schoolRoom(env).issueToken({
    kind: 'today_view',
    studentId,
    createdBy: actor.userId,
    tokenHash,
    expiresAt,
    createdAt: new Date(now).toISOString(),
  })
  return { token, expiresAt }
}
