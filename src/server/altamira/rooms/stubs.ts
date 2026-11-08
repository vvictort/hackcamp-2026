import type { Env } from '../../../../worker'
import { insightsRoomId, schoolRoomId, studentRoomId } from '../contract/common'
import { DISTRICT, SCHOOL } from '../fixtures/school'
import type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from './rpc'

/** The Env fields Altamira uses. */
export type AltamiraBindings = Pick<
  Env,
  'STUDENT_ROOMS' | 'SCHOOL_ROOMS' | 'INSIGHTS_ROOMS' | 'ALTAMIRA_SCHOOL_ID' | 'ALTAMIRA_DISTRICT_ID'
>

/**
 * Single-school deployment: the school and district come from env, defaulting
 * to the fictional fixture school until a membership index exists.
 */
export const altamiraSchoolId = (env: Pick<Env, 'ALTAMIRA_SCHOOL_ID'>): string => env.ALTAMIRA_SCHOOL_ID || SCHOOL.id
export const altamiraDistrictId = (env: Pick<Env, 'ALTAMIRA_DISTRICT_ID'>): string =>
  env.ALTAMIRA_DISTRICT_ID || DISTRICT.id

// DOBindings types the namespaces without their class, so stubs are cast to the room's RPC surface.
export function studentRoom(env: Pick<Env, 'STUDENT_ROOMS'>, studentId: string): StudentRoomRpc & Fetcher {
  const ns = env.STUDENT_ROOMS
  return ns.get(ns.idFromName(studentRoomId(studentId))) as unknown as StudentRoomRpc & Fetcher
}

export function schoolRoom(env: Pick<Env, 'SCHOOL_ROOMS' | 'ALTAMIRA_SCHOOL_ID'>): SchoolRoomRpc {
  const ns = env.SCHOOL_ROOMS
  return ns.get(ns.idFromName(schoolRoomId(altamiraSchoolId(env)))) as unknown as SchoolRoomRpc
}

export function insightsRoom(env: Pick<Env, 'INSIGHTS_ROOMS' | 'ALTAMIRA_DISTRICT_ID'>): InsightsRoomRpc {
  const ns = env.INSIGHTS_ROOMS
  return ns.get(ns.idFromName(insightsRoomId(altamiraDistrictId(env)))) as unknown as InsightsRoomRpc
}

/**
 * Forwards a WebSocket upgrade to the student room's live timeline. Call only
 * after the route's scope check (design doc: /api/v1/students/:id/live).
 */
export function openStudentLive(env: Pick<Env, 'STUDENT_ROOMS'>, studentId: string, request: Request): Promise<Response> {
  return studentRoom(env, studentId).fetch(new Request('https://altamira.internal/live', request))
}
