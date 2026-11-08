import type { AltamyraRole } from './role'

export type Member = { userId: string; displayName: string | null; role: string; studentId: string | null; classId: string | null }

/** Request body for POST /admin/schools/:id/memberships. Parents become a parent link. */
export function assignBody(f: { userId: string; displayName: string; role: AltamyraRole; studentId: string }) {
  const userId = f.userId.trim()
  const displayName = f.displayName.trim()
  const studentId = f.studentId.trim()
  if (f.role === 'parent') return { kind: 'parent_link' as const, userId, displayName, studentId }
  return { kind: 'membership' as const, userId, displayName, role: f.role, studentId: studentId || null, classId: null, districtId: null }
}

/** Roles that must be tied to one student when assigned. */
export const NEEDS_STUDENT: AltamyraRole[] = ['ea', 'parent']
