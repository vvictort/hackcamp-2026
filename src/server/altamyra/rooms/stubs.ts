import type { Env } from '../../../../worker'
import { insightsRoomId, schoolRoomId, studentRoomId } from '../contract/common'
import { DISTRICT, SCHOOL } from '../fixtures/school'
import type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from './rpc'

/** The Env fields Altamyra uses. */
export type AltamyraBindings = Pick<
  Env,
  'STUDENT_ROOMS' | 'SCHOOL_ROOMS' | 'INSIGHTS_ROOMS' | 'ALTAMYRA_SCHOOL_ID' | 'ALTAMYRA_DISTRICT_ID'
>

/**
 * Single-school deployment: the school and district come from env, defaulting
 * to the fictional fixture school until a membership index exists.
 */
export const altamyraSchoolId = (env: Pick<Env, 'ALTAMYRA_SCHOOL_ID'>): string => env.ALTAMYRA_SCHOOL_ID || SCHOOL.id
export const altamyraDistrictId = (env: Pick<Env, 'ALTAMYRA_DISTRICT_ID'>): string =>
  env.ALTAMYRA_DISTRICT_ID || DISTRICT.id

// DOBindings types the namespaces without their class, so stubs are cast to the room's RPC surface.
export function studentRoom(env: Pick<Env, 'STUDENT_ROOMS'>, studentId: string): StudentRoomRpc & Fetcher {
  const ns = env.STUDENT_ROOMS
  return ns.get(ns.idFromName(studentRoomId(studentId))) as unknown as StudentRoomRpc & Fetcher
}

export function schoolRoom(env: Pick<Env, 'SCHOOL_ROOMS' | 'ALTAMYRA_SCHOOL_ID'>): SchoolRoomRpc {
  const ns = env.SCHOOL_ROOMS
  return ns.get(ns.idFromName(schoolRoomId(altamyraSchoolId(env)))) as unknown as SchoolRoomRpc
}

export function insightsRoom(env: Pick<Env, 'INSIGHTS_ROOMS' | 'ALTAMYRA_DISTRICT_ID'>): InsightsRoomRpc {
  const ns = env.INSIGHTS_ROOMS
  return ns.get(ns.idFromName(insightsRoomId(altamyraDistrictId(env)))) as unknown as InsightsRoomRpc
}

/**
 * Forwards a WebSocket upgrade to the student room's live timeline. Call only
 * after the route's scope check (design doc: /api/v1/students/:id/live).
 */
export function openStudentLive(env: Pick<Env, 'STUDENT_ROOMS'>, studentId: string, request: Request): Promise<Response> {
  return studentRoom(env, studentId).fetch(new Request('https://altamyra.internal/live', request))
}
