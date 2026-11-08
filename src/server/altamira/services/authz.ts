import { z } from 'zod'
import { Id } from '../contract/common'
import { AltamiraError } from '../contract/errors'
import { can, type Actor, type CanOptions, type CanResult, type Capability, type StaffRole } from '../contract/permissions'

/**
 * Server-side permission checks inside room ops (PRD NFR Security: "role and
 * per-student scope checks on every request, enforced server-side"). Routes
 * check can() first; ops check again because some rules depend on row data
 * (own entries, IEP-authorized subjects, data filters).
 */

export type Allowed = Extract<CanResult, { allowed: true }>

/** Every student-room op takes the student id so it can call can(). */
export const StudentArgs = z.object({ studentId: Id })
export type StudentArgs = z.infer<typeof StudentArgs>

/** Optional clock for deterministic tests and jobs. */
export const Now = z.object({ now: z.string().optional() })

export function authorize(actor: Actor, capability: Capability, studentId: string | null, opts: CanOptions = {}): Allowed {
  const result = can(actor, capability, studentId, opts)
  if (result.allowed) return result
  if (result.reason === 'expired') throw new AltamiraError('gone', 'this link or session has expired')
  const hint = result.via ? `; use ${result.via}` : ''
  throw new AltamiraError('forbidden', `${capability} refused: ${result.reason}${hint}`)
}

/** Staff roles only: a student session or a link never passes. */
export function authorizeStaff(actor: Actor, capability: Capability, studentId: string, opts: CanOptions = {}): Allowed {
  const allowed = authorize(actor, capability, studentId, opts)
  if (!(['case_manager', 'teacher', 'ea'] as const satisfies readonly StaffRole[]).includes(allowed.role as StaffRole)) {
    throw new AltamiraError('forbidden', `${capability} needs a staff role`)
  }
  return allowed
}

/** The student session behind the actor, checked against the student. */
export function requireStudentSession(actor: Actor, studentId: string, now: string) {
  authorize(actor, 'evidence.capture', studentId, { now: Date.parse(now) })
  const session = actor.session
  if (!session || session.kind !== 'student_session') throw new AltamiraError('forbidden', 'student mode needs a student session')
  return session
}
