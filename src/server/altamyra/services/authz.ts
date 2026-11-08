import { z } from 'zod'
import { Id } from '../contract/common'
import { AltamyraError } from '../contract/errors'
import { STAFF_ROLES, can, type Actor, type CanOptions, type CanResult, type Capability } from '../contract/permissions'

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
  throw new AltamyraError('forbidden', `${capability} refused: ${result.reason}`)
}

/** Staff roles only: a student session or a link never passes. */
export function authorizeStaff(actor: Actor, capability: Capability, studentId: string, opts: CanOptions = {}): Allowed {
  const allowed = authorize(actor, capability, studentId, opts)
  if (!(STAFF_ROLES as readonly string[]).includes(allowed.role)) {
    throw new AltamyraError('forbidden', `${capability} needs a staff role`)
  }
  return allowed
}
