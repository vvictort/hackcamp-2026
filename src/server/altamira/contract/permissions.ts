/**
 * The PRD permission matrix as code (PRD "Roles and modes" / "Permission
 * matrix"; NFR Security: "enforced server-side from the permission matrix").
 * Every route calls can() before it touches a room.
 */

export const ACTOR_ROLES = [
  'case_manager',
  'teacher',
  'ea',
  'student_session',
  'parent',
  'substitute_link',
  'district_lead',
  'school_admin',
] as const
export type ActorRole = (typeof ACTOR_ROLES)[number]

/** Roles a staff user holds per student (teacher is derived from class rosters). */
export const STAFF_ROLES = ['case_manager', 'teacher', 'ea'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** One capability per PRD matrix row (design doc), plus the two non-student ones. */
export const STUDENT_CAPABILITIES = [
  'iep.write',
  'iep.propose',
  'objective.confirm',
  'objective.propose',
  'iep.view',
  'lesson.augment',
  'adaptation.approve',
  'modification.apply',
  'evidence.capture',
  'review.confirm',
  'proficiency.set',
  'draft.edit',
  'family_summary.approve',
  'progress.view',
  'consent.manage',
  'consent.record',
  'today_link.create',
  'parent_input.send',
] as const

/** Not student-scoped: district aggregates and role assignment by a school administrator. */
export const NON_STUDENT_CAPABILITIES = ['insights.view', 'membership.manage'] as const

export const CAPABILITIES = [...STUDENT_CAPABILITIES, ...NON_STUDENT_CAPABILITIES] as const
export type Capability = (typeof CAPABILITIES)[number]
export type StudentCapability = (typeof STUDENT_CAPABILITIES)[number]

/** Capabilities that only read; a "read" grant satisfies them without opts.access. */
export const READ_CAPABILITIES: readonly Capability[] = ['iep.view', 'progress.view', 'insights.view']

/**
 * What a matrix cell grants.
 * - full: read and write, within the actor's scope
 * - read: read only (writes refused with reason "read_only")
 * - redirect: refused; the actor must use `via` instead (e.g. teacher proposes)
 * - iep_authorized: only where the student's IEP authorizes modification for the subject
 * - own_entries: only rows the actor recorded
 */
export type Grant = 'full' | 'read' | 'redirect' | 'iep_authorized' | 'own_entries'

/** How the repository layer must filter what an allowed actor sees. */
export type DataFilter =
  | 'all'
  | 'supports_only' // EA: supports and what works, no IEP text
  | 'supports_applied' // student mode: supports applied, never shown; no IEP text
  | 'confirmed_only' // parent: status IN ('confirmed', 'auto_confirmed')
  | 'today' // EA: assigned students, today
  | 'self_simplified' // student mode: own progress, strengths-based
  | 'today_view' // substitute link: Today View fields only
  | 'approved_only' // viewers of 1A output: approved adaptations only

export type Cell = {
  grant: Grant
  filter: DataFilter
  /** The PRD matrix wording for this cell. */
  prd: string
  via?: Capability
}

const full = (prd: string, filter: DataFilter = 'all'): Cell => ({ grant: 'full', filter, prd })
const read = (prd: string, filter: DataFilter): Cell => ({ grant: 'read', filter, prd })
const redirect = (prd: string, via: Capability): Cell => ({ grant: 'redirect', filter: 'all', prd, via })

const lessonRow: Partial<Record<ActorRole, Cell>> = {
  case_manager: full('Yes'),
  teacher: full('Yes'),
  ea: read('View', 'approved_only'),
  student_session: read('Receives', 'supports_applied'),
  parent: read('View', 'approved_only'),
}

/** Missing cell = "—" in the PRD = refused. */
export const PERMISSION_MATRIX: Record<Capability, Partial<Record<ActorRole, Cell>>> = {
  // PRD row "Create, upload or edit the IEP and profile"
  'iep.write': {
    case_manager: full('Yes'),
    teacher: redirect('Propose only', 'iep.propose'),
    parent: redirect('Send input', 'parent_input.send'),
  },
  'iep.propose': { teacher: full('Propose only') },
  'parent_input.send': { parent: full('Send input') },

  // PRD row "Confirm measurable objectives, baselines, targets"
  'objective.confirm': {
    case_manager: full('Yes'),
    teacher: redirect('Propose only', 'objective.propose'),
  },
  'objective.propose': { teacher: full('Propose only') },

  // PRD row "View IEP goals and accommodations"
  'iep.view': {
    case_manager: full('Yes'),
    teacher: full('Own students'),
    ea: read('Supports and what works only', 'supports_only'),
    student_session: read('Supports applied, not shown', 'supports_applied'),
    parent: read('Own child', 'all'),
    substitute_link: read('Today View fields only', 'today_view'),
  },

  // PRD row "Augment lessons and approve adaptations (1A)"
  'lesson.augment': lessonRow,
  'adaptation.approve': lessonRow,

  // PRD row "Apply a modification" (PRD 1A-5)
  'modification.apply': {
    case_manager: { grant: 'iep_authorized', filter: 'all', prd: 'Authorizes in the IEP' },
    teacher: { grant: 'iep_authorized', filter: 'all', prd: 'Only where the IEP authorizes' },
  },

  // PRD row "Capture evidence (photos, counters, prompt levels)"
  'evidence.capture': {
    case_manager: full('Yes'),
    teacher: full('Yes'),
    ea: full('Yes'),
    student_session: full('Automatic from own activities'),
  },

  // PRD row "Confirm review queue and correct data points"
  'review.confirm': {
    case_manager: full('Yes'),
    teacher: full('Own students'),
    ea: { grant: 'own_entries', filter: 'all', prd: 'Own entries' },
  },

  // PRD row "Set proficiency level and edit progress drafts"
  'proficiency.set': { case_manager: full('Yes'), teacher: full('Yes') },
  'draft.edit': { case_manager: full('Yes'), teacher: full('Yes') },

  // PRD row "Approve family summaries"
  'family_summary.approve': { case_manager: full('Yes'), teacher: full('Yes') },

  // PRD row "View progress and timeline"
  'progress.view': {
    case_manager: full('Caseload'),
    teacher: full('Own students'),
    ea: read('Assigned students, today', 'today'),
    student_session: read('Self, simplified', 'self_simplified'),
    parent: read('Own child, confirmed data only', 'confirmed_only'),
  },

  // PRD row "Manage consent (audio, student mode)"
  'consent.manage': {
    case_manager: redirect('Records it', 'consent.record'),
    parent: full('Yes'),
  },
  'consent.record': { case_manager: full('Records it') },

  // PRD row "Create Today View links"
  'today_link.create': { case_manager: full('Yes'), teacher: full('Yes') },

  // District leads see only anonymized aggregates (PRD "Roles and modes").
  'insights.view': { district_lead: read('Anonymized aggregates only', 'all') },
  // "Role assignment is done by a school administrator outside these roles."
  'membership.manage': { school_admin: full('Assigns roles') },
}

/** A session principal: a student-mode device session or a substitute's Today View link. */
export type ActorSession = {
  kind: 'student_session' | 'substitute_link'
  studentId: string
  tokenId: string
  expiresAt: string
  /** The teacher or EA who started a student session; null for a substitute link. */
  startedBy: string | null
}

/**
 * The caller, as built by the altamiraAuth middleware from the school room.
 * When `session` is set, only the session's role applies, whatever else is filled in.
 */
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
  session: ActorSession | null
}

export const userActor = (userId: string, parts: Partial<Omit<Actor, 'userId' | 'session'>> = {}): Actor => ({
  userId,
  studentRoles: parts.studentRoles ?? {},
  parentOf: parts.parentOf ?? [],
  classIds: parts.classIds ?? [],
  schoolAdminOf: parts.schoolAdminOf ?? [],
  districtLeadOf: parts.districtLeadOf ?? [],
  session: null,
})

export const sessionActor = (session: ActorSession): Actor => ({
  userId: session.kind === 'substitute_link' ? `link:${session.tokenId}` : `session:${session.tokenId}`,
  studentRoles: {},
  parentOf: [],
  classIds: [],
  schoolAdminOf: [],
  districtLeadOf: [],
  session,
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
  /** membership.manage */
  schoolId?: string
  /** Epoch ms; defaults to Date.now(). */
  now?: number
}

export type DenyReason =
  | 'student_required'
  | 'not_in_scope'
  | 'not_permitted'
  | 'propose_only'
  | 'read_only'
  | 'not_iep_authorized'
  | 'not_own_entry'
  | 'expired'

export type CanResult =
  | { allowed: true; reason: 'ok'; role: ActorRole; filter: DataFilter }
  | { allowed: false; reason: DenyReason; role?: ActorRole; via?: Capability }

const ROLE_ORDER: readonly ActorRole[] = ['case_manager', 'teacher', 'ea', 'parent', 'student_session', 'substitute_link']

/** Roles the actor holds for this student, most powerful first. */
export function rolesFor(actor: Actor, studentId: string, now: number = Date.now()): ActorRole[] | 'expired' {
  if (actor.session) {
    // Student session: only its student. Substitute link: only its student until expiry.
    if (actor.session.studentId !== studentId) return []
    if (Date.parse(actor.session.expiresAt) <= now) return 'expired'
    return [actor.session.kind]
  }
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
    case 'redirect':
      // PRD: teachers may only propose IEP or objective changes; parents send input.
      return { allowed: false, reason: 'propose_only', via: cell.via }
    case 'iep_authorized': {
      // PRD 1A-5: a modification passes only for a subject the current IEP authorizes.
      const subject = opts.subject ? norm(opts.subject) : ''
      const authorized = (opts.modificationSubjects ?? []).map(norm)
      if (subject && authorized.includes(subject)) return null
      return { allowed: false, reason: 'not_iep_authorized' }
    }
    case 'own_entries':
      // PRD matrix: EAs confirm or correct only their own entries.
      if (opts.recordedBy !== undefined && opts.recordedBy === actor.userId) return null
      return { allowed: false, reason: 'not_own_entry' }
  }
}

function canNonStudent(actor: Actor, capability: Capability, opts: CanOptions): CanResult {
  if (actor.session) return { allowed: false, reason: 'not_permitted' }
  if (capability === 'insights.view') {
    if (opts.districtId && actor.districtLeadOf.includes(opts.districtId)) {
      return { allowed: true, reason: 'ok', role: 'district_lead', filter: 'all' }
    }
    return { allowed: false, reason: 'not_in_scope' }
  }
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

  const roles = rolesFor(actor, studentId, opts.now ?? Date.now())
  if (roles === 'expired') return { allowed: false, reason: 'expired' }
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
