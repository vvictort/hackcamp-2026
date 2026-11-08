import type { MembershipRole } from '../contract/enums'
import { userActor, type Actor, type StaffRole } from '../contract/permissions'
import type { SqlExecutor } from '../contract/ops'

/**
 * Builds the caller's Actor from the school room (design doc "Request flow"):
 * case manager and EA memberships name a student, teacher memberships name a
 * class whose roster gives the teacher's students, parent_links give a
 * parent's children. Runs inside AltamyraSchoolRoom.loadActor().
 */
export function loadActor(sql: SqlExecutor, userId: string, schoolId: string): Actor {
  const memberships = sql.all<{
    role: MembershipRole
    student_id: string | null
    class_id: string | null
    district_id: string | null
  }>('SELECT role, student_id, class_id, district_id FROM memberships WHERE user_id = ? ORDER BY id', userId)

  const studentRoles: Record<string, StaffRole[]> = {}
  const grant = (studentId: string, role: StaffRole) => {
    const roles = (studentRoles[studentId] ??= [])
    if (!roles.includes(role)) roles.push(role)
  }
  const classIds: string[] = []
  const schoolAdminOf: string[] = []
  const districtLeadOf: string[] = []

  for (const m of memberships) {
    if ((m.role === 'case_manager' || m.role === 'ea') && m.student_id) grant(m.student_id, m.role)
    if (m.role === 'teacher' && m.class_id && !classIds.includes(m.class_id)) classIds.push(m.class_id)
    if (m.role === 'school_admin' && !schoolAdminOf.includes(schoolId)) schoolAdminOf.push(schoolId)
    if (m.role === 'district_lead' && m.district_id && !districtLeadOf.includes(m.district_id)) {
      districtLeadOf.push(m.district_id)
    }
  }

  // contract/permissions.ts: teachers hold 'teacher' for every student on their class rosters.
  for (const classId of classIds) {
    for (const r of sql.all<{ student_id: string }>('SELECT student_id FROM roster WHERE class_id = ? ORDER BY student_id', classId)) {
      grant(r.student_id, 'teacher')
    }
  }

  const parentOf = sql
    .all<{ student_id: string }>('SELECT student_id FROM parent_links WHERE parent_user_id = ? ORDER BY student_id', userId)
    .map((r) => r.student_id)

  return userActor(userId, { studentRoles, parentOf, classIds, schoolAdminOf, districtLeadOf })
}

/** Opaque student ids in the school room, for jobs that visit every student room. */
export function listStudentIds(sql: SqlExecutor): string[] {
  return sql.all<{ id: string }>('SELECT id FROM students ORDER BY id').map((r) => r.id)
}
