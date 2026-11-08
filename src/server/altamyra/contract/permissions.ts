/**
 * The PRD permission matrix as code (PRD "Roles and modes" / "Permission
 * matrix"; NFR Security: "enforced server-side from the permission matrix").
 * Every route calls can() before it touches a room.
 */

export const ACTOR_ROLES = ['case_manager', 'teacher', 'ea', 'parent', 'district_lead', 'school_admin'] as const
export type ActorRole = (typeof ACTOR_ROLES)[number]

/** Roles a staff user holds per student (teacher is derived from class rosters). */
export const STAFF_ROLES = ['case_manager', 'teacher', 'ea'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** One capability per row of the role model (design doc), student-scoped. */
export const STUDENT_CAPABILITIES = [
  // IEP: the case manager imports (and confirms measurable objectives at upload); changes go through tickets.
  'iep.import',
  'objective.confirm',
  'iep.view',
  'ticket.submit',
  // Lesson plans: original, proposed changes and tailored (Lesson Lens).
  'lesson_plan.view',
  'lesson_plan.edit',
  'adaptation.approve',
  'modification.apply',
  // Capture and review.
  'evidence.capture',
  'review.confirm',
  'proficiency.set',
  // Daily / weekly / monthly summaries. Only the EA and the teacher edit or approve them.
  'summary.view',
  'summary.edit',
  'summary.approve',
  'summary.caseload',
  'progress.view',
  'consent.manage',
] as const

/** Not student-scoped: district aggregates, role assignment and IEP change tickets (school administrator). */
export const NON_STUDENT_CAPABILITIES = ['insights.view', 'membership.manage', 'ticket.review'] as const

export const CAPABILITIES = [...STUDENT_CAPABILITIES, ...NON_STUDENT_CAPABILITIES] as const
export type Capability = (typeof CAPABILITIES)[number]
export type StudentCapability = (typeof STUDENT_CAPABILITIES)[number]

/** Capabilities that only read; a "read" grant satisfies them without opts.access. */
export const READ_CAPABILITIES: readonly Capability[] = ['iep.view', 'progress.view', 'insights.view', 'lesson_plan.view', 'summary.view', 'summary.caseload']

/**
 * What a matrix cell grants.
 * - full: read and write, within the actor's scope
 * - read: read only (writes refused with reason "read_only")
 * - iep_authorized: only where the student's IEP authorizes modification for the subject
 * - own_entries: only rows the actor recorded
 */
export type Grant = 'full' | 'read' | 'iep_authorized' | 'own_entries'

/** How the repository layer must filter what an allowed actor sees. */
export type DataFilter =
  | 'all'
  | 'confirmed_only' // status IN ('confirmed', 'auto_confirmed')
  | 'approved_only' // AI content that an EA or the teacher approved; drafts stay hidden

export type Cell = {
  grant: Grant
  filter: DataFilter
  /** The matrix wording for this cell. */
  prd: string
}

const full = (prd: string, filter: DataFilter = 'all'): Cell => ({ grant: 'full', filter, prd })
const read = (prd: string, filter: DataFilter = 'all'): Cell => ({ grant: 'read', filter, prd })
const own = (prd: string): Cell => ({ grant: 'own_entries', filter: 'all', prd })

/** Missing cell = refused (403). */
export const PERMISSION_MATRIX: Record<Capability, Partial<Record<ActorRole, Cell>>> = {
  // Case manager imports the IEP. No direct edits: later changes are tickets.
  'iep.import': { case_manager: full('Import and view') },
  'objective.confirm': { case_manager: full('Confirms at upload') },
  'ticket.submit': { case_manager: full('Submits change tickets') },

  'iep.view': {
    case_manager: full('Caseload'),
    teacher: read('Class students'),
    ea: read('Assigned students'),
  },

  // Original lesson plan, proposed changes, tailored plan. The teacher edits and approves; others read approved plans.
  'lesson_plan.view': {
    case_manager: read('Approved plans', 'approved_only'),
    teacher: full('Class students'),
    ea: read('Approved plans', 'approved_only'),
  },
  'lesson_plan.edit': {
    teacher: full('Class students'),
    ea: read('Approved plans', 'approved_only'),
    case_manager: read('Approved plans', 'approved_only'),
  },
  'adaptation.approve': { teacher: full('Approves tailored plans') },
  'modification.apply': { teacher: { grant: 'iep_authorized', filter: 'all', prd: 'Only where the IEP authorizes' } },

  'evidence.capture': { teacher: full('Class students'), ea: full('Assigned students') },
  'review.confirm': { teacher: own('Own captures'), ea: own('Own captures') },
  'proficiency.set': { teacher: full('Class students') },

  'summary.view': {
    teacher: full('Class students'),
    ea: full('Assigned students'),
    case_manager: read('Approved summaries', 'approved_only'),
    parent: read('Own child, approved only', 'approved_only'),
  },
  'summary.edit': { teacher: full('Class students'), ea: full('Assigned students') },
  'summary.approve': { teacher: full('Class students'), ea: full('Assigned students') },
  'summary.caseload': { case_manager: read('Approved weekly summaries across the caseload', 'approved_only') },

  'progress.view': {
    case_manager: read('Caseload'),
    teacher: read('Class students'),
    ea: read('Assigned students'),
  },

  'consent.manage': { parent: full('Own child') },

  // District leads see only anonymized aggregates.
  'insights.view': { district_lead: read('Anonymized aggregates only') },
  // Role assignment and IEP change tickets: school administrator, no student-level data.
  'membership.manage': { school_admin: full('Assigns roles') },
  'ticket.review': { school_admin: full('Applies or declines tickets') },
}

/** The caller, as built by the altamyraAuth middleware from the school room. */
export type Actor = {
  userId: string
  /** studentId -> staff roles held for that student. */
  studentRoles: Record<string, StaffRole[]>
  /** Students this user is a parent or guardian of (parent_links). */
  parentOf: string[]
  /** Classes this user teaches. */
  classIds: string[]
  schoolAdminOf: string[]
  districtLeadOf: string[]
}

export const userActor = (userId: string, parts: Partial<Omit<Actor, 'userId'>> = {}): Actor => ({
  userId,
  studentRoles: parts.studentRoles ?? {},
  parentOf: parts.parentOf ?? [],
  classIds: parts.classIds ?? [],
  schoolAdminOf: parts.schoolAdminOf ?? [],
  districtLeadOf: parts.districtLeadOf ?? [],
})

export type CanOptions = {
  /** "read" lets a read-only grant pass on a write-type capability (e.g. EA viewing approved lessons). */
  access?: 'read' | 'write'
  /** modification.apply: subject key of the lesson, e.g. "math". */
  subject?: string
  /** modification.apply: subjects the student's current IEP authorizes (IepVersion.modificationSubjects). */
  modificationSubjects?: readonly string[]
  /** review.confirm: recorder of the data point being confirmed or corrected. */
  recordedBy?: string
  /** insights.view */
  districtId?: string
  /** membership.manage, ticket.review */
  schoolId?: string
  /** Epoch ms; defaults to Date.now(). */
  now?: number
}

export type DenyReason = 'student_required' | 'not_in_scope' | 'not_permitted' | 'read_only' | 'not_iep_authorized' | 'not_own_entry'

export type CanResult =
  | { allowed: true; reason: 'ok'; role: ActorRole; filter: DataFilter }
  | { allowed: false; reason: DenyReason; role?: ActorRole }

const ROLE_ORDER: readonly ActorRole[] = ['case_manager', 'teacher', 'ea', 'parent']

/** Roles the actor holds for this student, most powerful first. */
export function rolesFor(actor: Actor, studentId: string): ActorRole[] {
  const held = new Set<ActorRole>(actor.studentRoles[studentId] ?? [])
  // Parent: own child only.
  if (actor.parentOf.includes(studentId)) held.add('parent')
  return ROLE_ORDER.filter((r) => held.has(r))
}

const norm = (s: string) => s.trim().toLowerCase()

function checkCell(cell: Cell, capability: Capability, actor: Actor, opts: CanOptions): CanResult | null {
  switch (cell.grant) {
    case 'full':
      return null
    case 'read':
      if (READ_CAPABILITIES.includes(capability) || opts.access === 'read') return null
      return { allowed: false, reason: 'read_only' }
    case 'iep_authorized': {
      // PRD 1A-5: a modification passes only for a subject the current IEP authorizes.
      const subject = opts.subject ? norm(opts.subject) : ''
      const authorized = (opts.modificationSubjects ?? []).map(norm)
      if (subject && authorized.includes(subject)) return null
      return { allowed: false, reason: 'not_iep_authorized' }
    }
    case 'own_entries':
      // EAs and teachers confirm or correct only their own captures.
      if (opts.recordedBy !== undefined && opts.recordedBy === actor.userId) return null
      return { allowed: false, reason: 'not_own_entry' }
  }
}

function canNonStudent(actor: Actor, capability: Capability, opts: CanOptions): CanResult {
  if (capability === 'insights.view') {
    if (opts.districtId && actor.districtLeadOf.includes(opts.districtId)) {
      return { allowed: true, reason: 'ok', role: 'district_lead', filter: 'all' }
    }
    return { allowed: false, reason: 'not_in_scope' }
  }
  // membership.manage and ticket.review: school administrator of that school.
  if (opts.schoolId && actor.schoolAdminOf.includes(opts.schoolId)) {
    return { allowed: true, reason: 'ok', role: 'school_admin', filter: 'all' }
  }
  return { allowed: false, reason: 'not_in_scope' }
}

/**
 * Decide whether `actor` may use `capability` on `studentId`.
 * District leads and school admins hold no student access through these roles.
 */
export function can(actor: Actor, capability: Capability, studentId?: string | null, opts: CanOptions = {}): CanResult {
  if ((NON_STUDENT_CAPABILITIES as readonly string[]).includes(capability)) {
    return canNonStudent(actor, capability, opts)
  }
  if (!studentId) return { allowed: false, reason: 'student_required' }

  const roles = rolesFor(actor, studentId)
  if (roles.length === 0) return { allowed: false, reason: 'not_in_scope' }

  const row = PERMISSION_MATRIX[capability]
  let firstDenial: CanResult | null = null
  for (const role of roles) {
    const cell = row[role]
    const result: CanResult = cell
      ? (checkCell(cell, capability, actor, opts) ?? { allowed: true, reason: 'ok', role, filter: cell.filter })
      : { allowed: false, reason: 'not_permitted' }
    if (result.allowed) return result
    firstDenial ??= { ...result, role }
  }
  return firstDenial ?? { allowed: false, reason: 'not_permitted' }
}
