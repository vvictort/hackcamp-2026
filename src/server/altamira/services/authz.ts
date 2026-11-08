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
  throw new AltamiraError('forbidden', `${capability} refused: ${result.reason}`)
}

/** Staff roles only: a student session or a link never passes. */
export function authorizeStaff(actor: Actor, capability: Capability, studentId: string, opts: CanOptions = {}): Allowed {
  const allowed = authorize(actor, capability, studentId, opts)
  if (!(['case_manager', 'teacher', 'ea'] as const satisfies readonly StaffRole[]).includes(allowed.role as StaffRole)) {
    throw new AltamiraError('forbidden', `${capability} needs a staff role`)
  }
  return allowed
}

/**
 * Reading a student's objectives (id, metric, unit, target, mastery rule). Any
 * staff role in scope may read them so the capture screens can list goals to
 * record against. Editing stays with the case manager at upload (objective.confirm).
 */
export function authorizeObjectivesRead(actor: Actor, studentId: string, opts: CanOptions = {}): Allowed {
  return authorize(actor, 'iep.view', studentId, opts)
}

/** An EA (or any staff role) may record events and data points for a student they are assigned to. */
export function authorizeEventRecord(actor: Actor, studentId: string, opts: CanOptions = {}): Allowed {
  return authorizeStaff(actor, 'evidence.capture', studentId, opts)
}
