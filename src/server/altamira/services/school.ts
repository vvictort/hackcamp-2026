import { z } from 'zod'
import { AdminMembershipBody, type MeResponse, type ScheduleItem, type StudentSummary } from '../contract/api'
import { DateString, Id, MediaRef } from '../contract/common'
import { LessonSourceKind, ShareTokenKind } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor, type StaffRole } from '../contract/permissions'
import {
  Lesson as LessonSchema,
  LessonAnalysisBody,
  ShareToken as ShareTokenSchema,
  type Lesson,
  type LessonAnalysis,
  type LessonFile,
  type Membership,
  type ParentLink,
  type SheetCode,
  type ShareToken,
} from '../contract/school'
import type { SqlExecutor } from '../db/sql'
import { DISTRICT, SCHOOL, STUDENT_IDS, USER_IDS, seedSchool } from '../fixtures'
import { audit, insertEntity, mustFind, newId, nowIso, updateVersioned } from '../repos/base'
import * as repo from '../repos/school'
import { authorize, authorizeStaff } from './authz'
import { STUDENT_SESSION_MINUTES } from './thresholds'

/** School-room ops (AltamiraSchoolRoom). No student names live in this room. */

const dateOf = (iso: string) => iso.slice(0, 10)
const weekdayOf = (date: string) => new Date(`${date}T12:00:00.000Z`).getUTCDay()

/**
 * Class-level access through the permission matrix: the class teacher, or
 * anyone whose lesson.augment cell passes for a student on the roster.
 */
function authorizeClass(sql: SqlExecutor, actor: Actor, classId: string, access: 'read' | 'write'): void {
  if (!repo.classById(sql, classId)) throw new AltamiraError('not_found', `class ${classId} not found`)
  if (actor.session) throw new AltamiraError('forbidden', 'sessions and links cannot use lessons')
  if (actor.classIds.includes(classId)) return
  const ok = repo.rosterOf(sql, classId).some((sid) => can(actor, 'lesson.augment', sid, { access }).allowed)
  if (!ok) throw new AltamiraError('forbidden', `lesson.augment refused for class ${classId}`)
}

// ---------- auth support ----------

/**
 * Builds the role parts of an Actor for the altamiraAuth middleware.
 * Teachers get 'teacher' for every student on their class rosters.
 */
export const actorLoad = defineOp({
  name: 'actor.load',
  room: 'school',
  args: z.object({ userId: Id, schoolId: Id }),
  run(sql, args) {
    const studentRoles: Record<string, StaffRole[]> = {}
    const add = (sid: string, role: StaffRole) => {
      const roles = (studentRoles[sid] ??= [])
      if (!roles.includes(role)) roles.push(role)
    }
    const classIds: string[] = []
    const districtLeadOf: string[] = []
    let schoolAdmin = false
    for (const m of repo.membershipsOf(sql, args.userId)) {
      if ((m.role === 'case_manager' || m.role === 'ea') && m.studentId) add(m.studentId, m.role)
      if (m.role === 'teacher' && m.classId) {
        classIds.push(m.classId)
        repo.rosterOf(sql, m.classId).forEach((sid) => add(sid, 'teacher'))
      }
      if (m.role === 'school_admin') schoolAdmin = true
      if (m.role === 'district_lead' && m.districtId) districtLeadOf.push(m.districtId)
    }
    return {
      studentRoles,
      parentOf: repo.parentLinksOf(sql, args.userId).map((p) => p.studentId),
      classIds,
      schoolAdminOf: schoolAdmin ? [args.schoolId] : [],
      districtLeadOf,
    }
  },
})

// ---------- memberships (POST /admin/schools/:id/memberships) ----------

function ensureUser(sql: SqlExecutor, actor: Actor, userId: string, displayName: string, at: string): void {
  if (repo.userById(sql, userId)) return
  const user = { id: userId, displayName, createdAt: at }
  insertEntity(sql, 'users', user)
  audit(sql, actor, 'users.create', 'users', userId, undefined, user, at)
}

export const membershipsAssign = defineOp({
  name: 'memberships.assign',
  room: 'school',
  capability: 'membership.manage',
  args: z.object({ schoolId: Id, grant: AdminMembershipBody, now: z.string().optional() }),
  run(sql, { schoolId, grant, now }, actor): { membership: Membership | null; parentLink: ParentLink | null } {
    // PRD: "Role assignment is done by a school administrator outside these roles."
    authorize(actor, 'membership.manage', null, { schoolId })
    const at = nowIso(now)
    if (grant.studentId && !repo.studentById(sql, grant.studentId)) {
      throw new AltamiraError('not_found', `student ${grant.studentId} not found`)
    }
    ensureUser(sql, actor, grant.userId, grant.displayName, at)

    if (grant.kind === 'parent_link') {
      const existing = repo.findParentLink(sql, grant.userId, grant.studentId)
      if (existing) return { membership: null, parentLink: existing }
      const link: ParentLink = { id: newId(), parentUserId: grant.userId, studentId: grant.studentId, createdAt: at }
      insertEntity(sql, 'parent_links', link)
      audit(sql, actor, 'parent_links.create', 'parent_links', link.id, undefined, link, at)
      return { membership: null, parentLink: link }
    }

    const { role, studentId, classId, districtId } = grant
    const shapeOk =
      ((role === 'case_manager' || role === 'ea') && studentId && !classId) ||
      (role === 'teacher' && classId && !studentId) ||
      (role === 'school_admin' && !studentId && !classId) ||
      (role === 'district_lead' && !studentId && !classId && districtId)
    if (!shapeOk) throw new AltamiraError('bad_request', `a ${role} grant has the wrong scope fields`)
    if (classId && !repo.classById(sql, classId)) throw new AltamiraError('not_found', `class ${classId} not found`)

    const existing = repo.findMembership(sql, { userId: grant.userId, role, studentId, classId })
    if (existing) return { membership: existing, parentLink: null }
    const membership: Membership = {
      id: newId(),
      userId: grant.userId,
      role,
      studentId,
      classId,
      districtId: role === 'district_lead' ? districtId : null,
      createdAt: at,
      version: 1,
    }
    insertEntity(sql, 'memberships', membership)
    audit(sql, actor, 'memberships.create', 'memberships', membership.id, undefined, membership, at)
    return { membership, parentLink: null }
  },
})

// ---------- roster, classes, schedule (reads used by the API) ----------

export const studentsList = defineOp({
  name: 'students.list',
  room: 'school',
  args: z.object({}),
  run: (sql) => ({ students: repo.listStudents(sql) }),
})

export const studentsGet = defineOp({
  name: 'students.get',
  room: 'school',
  args: z.object({ studentId: Id }),
  run(sql, args) {
    const student = repo.studentById(sql, args.studentId)
    if (!student) throw new AltamiraError('not_found', `student ${args.studentId} not found`)
    return { student, classIds: repo.classesOfStudent(sql, args.studentId) }
  },
})

export const classesList = defineOp({
  name: 'classes.list',
  room: 'school',
  args: z.object({}),
  run: (sql) => ({ classes: repo.listClasses(sql) }),
})

export const classesGet = defineOp({
  name: 'classes.get',
  room: 'school',
  args: z.object({ classId: Id }),
  run(sql, args) {
    const cls = repo.classById(sql, args.classId)
    if (!cls) throw new AltamiraError('not_found', `class ${args.classId} not found`)
    return { class: cls, studentIds: repo.rosterOf(sql, args.classId) }
  },
})

export const rosterList = defineOp({
  name: 'roster.list',
  room: 'school',
  args: z.object({ classId: Id }),
  run: (sql, args) => ({ studentIds: repo.rosterOf(sql, args.classId) }),
})

export const scheduleList = defineOp({
  name: 'schedule.list',
  room: 'school',
  args: z.object({ classId: Id.optional(), date: DateString.optional() }),
  run(sql, args) {
    const blocks = args.date ? repo.blocksForWeekday(sql, weekdayOf(args.date)) : repo.listSchedule(sql)
    return { blocks: args.classId ? blocks.filter((b) => b.classId === args.classId) : blocks }
  },
})

// ---------- lessons (PRD 1A-1, 1A-2) ----------

export const lessonsCreate = defineOp({
  name: 'lessons.create',
  room: 'school',
  capability: 'lesson.augment',
  args: z.object({
    classId: Id,
    title: z.string().min(1),
    sourceKind: LessonSourceKind,
    text: z.string().nullable().default(null),
    file: MediaRef.nullable().default(null),
    scheduledFor: DateString.nullable().default(null),
    sizeBytes: z.number().int().min(0).default(0),
    now: z.string().optional(),
  }),
  run(sql, args, actor): { lesson: Lesson; files: LessonFile[] } {
    authorizeClass(sql, actor, args.classId, 'write')
    if (args.sourceKind === 'text' ? !args.text : !args.file) {
      throw new AltamiraError('bad_request', 'text lessons need text, files need file')
    }
    const at = nowIso(args.now)
    const lesson: Lesson = {
      id: newId(),
      classId: args.classId,
      title: args.title,
      sourceKind: args.sourceKind,
      text: args.text,
      scheduledFor: args.scheduledFor,
      createdBy: actor.userId,
      createdAt: at,
      version: 1,
    }
    insertEntity(sql, 'lessons', lesson)
    audit(sql, actor, 'lessons.create', 'lessons', lesson.id, undefined, lesson, at)
    const files: LessonFile[] = []
    if (args.file) {
      const file: LessonFile = {
        id: newId(),
        lessonId: lesson.id,
        storageKey: args.file.fileKey,
        contentType: args.file.contentType,
        sizeBytes: args.sizeBytes,
        createdAt: at,
      }
      insertEntity(sql, 'lesson_files', file)
      audit(sql, actor, 'lesson_files.create', 'lesson_files', file.id, undefined, file, at)
      files.push(file)
    }
    return { lesson, files }
  },
})

export const lessonsGet = defineOp({
  name: 'lessons.get',
  room: 'school',
  capability: 'lesson.augment',
  args: z.object({ lessonId: Id }),
  run(sql, args, actor) {
    const lesson = mustFind(sql, 'lessons', LessonSchema, args.lessonId)
    authorizeClass(sql, actor, lesson.classId, 'read')
    const cls = repo.classById(sql, lesson.classId)
    return {
      lesson,
      files: repo.filesOfLesson(sql, lesson.id),
      subject: cls?.subject ?? '',
      grade: cls?.grade ?? '',
      studentIds: repo.rosterOf(sql, lesson.classId),
    }
  },
})

/** PRD 1A-2: one cached analysis per lesson. A second save returns the cached row and writes nothing. */
export const lessonsSaveAnalysis = defineOp({
  name: 'lessons.saveAnalysis',
  room: 'school',
  capability: 'lesson.augment',
  args: z.object({ lessonId: Id, analysis: LessonAnalysisBody, provider: z.string().min(1), now: z.string().optional() }),
  run(sql, args, actor): { analysis: LessonAnalysis; cached: boolean } {
    const lesson = mustFind(sql, 'lessons', LessonSchema, args.lessonId)
    authorizeClass(sql, actor, lesson.classId, 'write')
    const existing = repo.analysisOfLesson(sql, lesson.id)
    if (existing) return { analysis: existing, cached: true }
    const at = nowIso(args.now)
    const analysis: LessonAnalysis = { id: newId(), lessonId: lesson.id, analysis: args.analysis, provider: args.provider, createdAt: at }
    insertEntity(sql, 'lesson_analyses', analysis)
    audit(sql, actor, 'lesson_analyses.create', 'lesson_analyses', analysis.id, undefined, analysis, at)
    return { analysis, cached: false }
  },
})

export const lessonsGetAnalysis = defineOp({
  name: 'lessons.getAnalysis',
  room: 'school',
  capability: 'lesson.augment',
  args: z.object({ lessonId: Id }),
  run(sql, args, actor): { analysis: LessonAnalysis | null } {
    const lesson = mustFind(sql, 'lessons', LessonSchema, args.lessonId)
    authorizeClass(sql, actor, lesson.classId, 'read')
    return { analysis: repo.analysisOfLesson(sql, lesson.id) ?? null }
  },
})

// ---------- sheet codes (PRD principle 3: codes identify student, lesson and check without a name) ----------

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `AL-${[...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`
}

export const sheetCodesIssue = defineOp({
  name: 'sheetCodes.issue',
  room: 'school',
  capability: 'lesson.augment',
  args: z.object({ studentId: Id, lessonId: Id, checkId: Id, now: z.string().optional() }),
  run(sql, args, actor): { sheetCode: SheetCode } {
    authorize(actor, 'lesson.augment', args.studentId)
    if (!repo.studentById(sql, args.studentId)) throw new AltamiraError('not_found', `student ${args.studentId} not found`)
    mustFind(sql, 'lessons', LessonSchema, args.lessonId)
    const existing = repo.findSheetCode(sql, args.studentId, args.lessonId, args.checkId)
    if (existing) return { sheetCode: existing }
    let code = randomCode()
    while (repo.sheetCodeByCode(sql, code)) code = randomCode()
    const at = nowIso(args.now)
    const sheetCode: SheetCode = { code, studentId: args.studentId, lessonId: args.lessonId, checkId: args.checkId, createdAt: at }
    insertEntity(sql, 'sheet_codes', sheetCode)
    audit(sql, actor, 'sheet_codes.create', 'sheet_codes', code, undefined, sheetCode, at)
    return { sheetCode }
  },
})

export const sheetCodesResolve = defineOp({
  name: 'sheetCodes.resolve',
  room: 'school',
  capability: 'evidence.capture',
  args: z.object({ code: z.string().min(1) }),
  run(sql, args, actor): { sheetCode: SheetCode } {
    const sheetCode = repo.sheetCodeByCode(sql, args.code.trim().toUpperCase())
    if (!sheetCode) throw new AltamiraError('not_found', 'unknown sheet code')
    authorizeStaff(actor, 'evidence.capture', sheetCode.studentId)
    return { sheetCode }
  },
})

// ---------- share tokens (Today View links and student-mode sessions) ----------

/**
 * Only the token hash reaches the room (services/tokens.ts hashes it in the
 * route, because hashing in Workers is async and room ops are synchronous).
 */
export const shareTokensCreate = defineOp({
  name: 'shareTokens.create',
  room: 'school',
  args: z.object({
    kind: ShareTokenKind,
    studentId: Id,
    tokenHash: z.string().min(16),
    /** Today View only; TodayLinkBody caps it at 24. */
    ttlHours: z.number().positive().max(24).default(12),
    now: z.string().optional(),
  }),
  run(sql, args, actor): { shareToken: ShareToken } {
    if (args.kind === 'today_view') authorizeStaff(actor, 'today_link.create', args.studentId)
    // Student sessions are started by a teacher or EA (PRD NFR Consent); the consent gate runs in the student room first.
    else authorizeStaff(actor, 'evidence.capture', args.studentId)
    if (!repo.studentById(sql, args.studentId)) throw new AltamiraError('not_found', `student ${args.studentId} not found`)
    const at = nowIso(args.now)
    const ttlMs = args.kind === 'today_view' ? args.ttlHours * 3_600_000 : STUDENT_SESSION_MINUTES * 60_000
    const shareToken: ShareToken = {
      id: newId(),
      tokenHash: args.tokenHash,
      kind: args.kind,
      studentId: args.studentId,
      createdBy: actor.userId,
      createdAt: at,
      expiresAt: new Date(Date.parse(at) + ttlMs).toISOString(),
      revokedAt: null,
      version: 1,
    }
    insertEntity(sql, 'share_tokens', shareToken)
    audit(sql, actor, 'share_tokens.create', 'share_tokens', shareToken.id, undefined, { ...shareToken, tokenHash: '[hash]' }, at)
    return { shareToken }
  },
})

/** Resolves a link or session token. Expired or revoked tokens answer 410 (design doc). */
export const shareTokensResolve = defineOp({
  name: 'shareTokens.resolve',
  room: 'school',
  args: z.object({ tokenHash: z.string().min(1), kind: ShareTokenKind.optional(), now: z.string().optional() }),
  run(sql, args) {
    const token = repo.shareTokenByHash(sql, args.tokenHash)
    if (!token || (args.kind && token.kind !== args.kind)) throw new AltamiraError('not_found', 'unknown link')
    if (token.revokedAt || Date.parse(token.expiresAt) <= Date.parse(nowIso(args.now))) {
      throw new AltamiraError('gone', 'this link has expired')
    }
    return { id: token.id, kind: token.kind, studentId: token.studentId, expiresAt: token.expiresAt, createdBy: token.createdBy }
  },
})

/**
 * With id: revoke one token (staff for that student). Without id: the daily
 * job revokes every token past its expiry.
 */
export const shareTokensExpire = defineOp({
  name: 'shareTokens.expire',
  room: 'school',
  args: z.object({ id: Id.optional(), now: z.string().optional() }),
  run(sql, args, actor): { expired: string[] } {
    const at = nowIso(args.now)
    const targets: ShareToken[] = []
    if (args.id) {
      const token = mustFind(sql, 'share_tokens', ShareTokenSchema, args.id)
      authorizeStaff(actor, token.kind === 'today_view' ? 'today_link.create' : 'evidence.capture', token.studentId)
      if (!token.revokedAt) targets.push(token)
    } else {
      targets.push(
        ...sql
          .all<{ id: string }>('SELECT id FROM share_tokens WHERE revoked_at IS NULL AND expires_at <= ?', at)
          .map((r) => mustFind(sql, 'share_tokens', ShareTokenSchema, r.id)),
      )
    }
    for (const token of targets) {
      updateVersioned(sql, 'share_tokens', token.id, token.version, { revoked_at: at })
      audit(sql, actor, 'share_tokens.expire', 'share_tokens', token.id, { revokedAt: null }, { revokedAt: at }, at)
    }
    return { expired: targets.map((t) => t.id) }
  },
})

// ---------- me (GET /me) ----------

export const meOverview = defineOp({
  name: 'me.overview',
  room: 'school',
  args: z.object({ date: DateString.optional(), now: z.string().optional() }),
  run(sql, args, actor): MeResponse {
    const date = args.date ?? dateOf(nowIso(args.now))
    const memberships = repo.membershipsOf(sql, actor.userId)
    const scoped = new Set<string>([...Object.keys(actor.studentRoles), ...actor.parentOf])

    const summary = (studentId: string): StudentSummary | null => {
      const s = repo.studentById(sql, studentId)
      if (!s) return null
      const roles: StudentSummary['roles'] = [...(actor.studentRoles[studentId] ?? [])]
      if (actor.parentOf.includes(studentId)) roles.push('parent')
      // Names live only in the student room; the route may fill firstName for allowed actors.
      return { id: s.id, displayToken: s.displayToken, firstName: null, grade: s.grade, roles }
    }
    const students = [...scoped].map(summary).filter((s): s is StudentSummary => s !== null)

    const classes = repo.listClasses(sql).filter(
      (c) => actor.classIds.includes(c.id) || repo.rosterOf(sql, c.id).some((sid) => actor.studentRoles[sid]?.length),
    )
    const todaySchedule: ScheduleItem[] = []
    for (const block of repo.blocksForWeekday(sql, weekdayOf(date))) {
      const cls = classes.find((c) => c.id === block.classId)
      if (!cls) continue
      const studentIds = repo.rosterOf(sql, cls.id).filter((sid) => actor.studentRoles[sid]?.length)
      const lesson = repo.lessonsOn(sql, cls.id, date)[0]
      todaySchedule.push({
        classId: cls.id,
        className: cls.name,
        subject: cls.subject,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        studentIds,
        lessonId: lesson?.id ?? null,
        lessonTitle: lesson?.title ?? null,
      })
    }

    return {
      userId: actor.userId,
      displayName: repo.userById(sql, actor.userId)?.displayName ?? null,
      memberships: memberships.map(({ role, studentId, classId, districtId }) => ({ role, studentId, classId, districtId })),
      caseload: students.filter((s) => s.roles.includes('case_manager')),
      students,
      classes: classes.map(({ id, name, subject, grade }) => ({ id, name, subject, grade })),
      todaySchedule,
      parentOf: actor.parentOf,
    }
  },
})

// ---------- dev seed (POST /dev/seed, dev only) ----------

/** Loads the fictional school. The route must gate this to dev mode. */
export const schoolDevSeed = defineOp({
  name: 'dev.seed',
  room: 'school',
  args: z.object({}),
  run(sql) {
    const seeded = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    if (seeded && seeded.n > 0) throw new AltamiraError('bad_request', 'school room is already seeded')
    seedSchool(sql)
    return {
      schoolId: SCHOOL.id,
      districtId: DISTRICT.id,
      studentIds: Object.values(STUDENT_IDS),
      userIds: { ...USER_IDS } as Record<string, string>,
    }
  },
})

export const schoolOpList = [
  actorLoad,
  membershipsAssign,
  studentsList,
  studentsGet,
  classesList,
  classesGet,
  rosterList,
  scheduleList,
  lessonsCreate,
  lessonsGet,
  lessonsSaveAnalysis,
  lessonsGetAnalysis,
  sheetCodesIssue,
  sheetCodesResolve,
  shareTokensCreate,
  shareTokensResolve,
  shareTokensExpire,
  meOverview,
  schoolDevSeed,
]
