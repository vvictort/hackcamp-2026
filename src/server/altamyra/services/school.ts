import { z } from 'zod'
import { AdminMembershipBody, type MeResponse, type ScheduleItem, type StudentSummary } from '../contract/api'
import { DateString, Id, MediaRef } from '../contract/common'
import { LessonSourceKind, type MembershipRole } from '../contract/enums'
import { AltamyraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor } from '../contract/permissions'
import {
  Lesson as LessonSchema,
  type Lesson,
  type LessonFile,
  type Membership,
  type ParentLink,
  type SheetCode,
} from '../contract/school'
import type { SqlExecutor } from '../db/sql'
import { DISTRICT, SCHOOL, STUDENT_IDS, USER_IDS, seedSchool, seedSchoolDemo } from '../fixtures'
import { audit, insertEntity, mustFind, newId, nowIso } from '../repos/base'
import * as repo from '../repos/school'
import { authorize, authorizeStaff } from './authz'

/** School-room ops (AltamyraSchoolRoom). No student names live in this room. */

const dateOf = (iso: string) => iso.slice(0, 10)
const weekdayOf = (date: string) => new Date(`${date}T12:00:00.000Z`).getUTCDay()

/**
 * Class-level access through the permission matrix: the class teacher, or
 * anyone whose lesson_plan.edit cell passes for a student on the roster.
 */
function authorizeClass(sql: SqlExecutor, actor: Actor, classId: string, access: 'read' | 'write'): void {
  if (!repo.classById(sql, classId)) throw new AltamyraError('not_found', `class ${classId} not found`)
  if (actor.classIds.includes(classId)) return
  const ok = repo.rosterOf(sql, classId).some((sid) => can(actor, 'lesson_plan.edit', sid, { access }).allowed)
  if (!ok) throw new AltamyraError('forbidden', `lesson_plan.edit refused for class ${classId}`)
}

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
  args: z.object({ schoolId: Id, grant: AdminMembershipBody, now: z.string().optional() }),
  run(sql, { schoolId, grant, now }, actor): { membership: Membership | null; parentLink: ParentLink | null } {
    // PRD: "Role assignment is done by a school administrator outside these roles."
    authorize(actor, 'membership.manage', null, { schoolId })
    const at = nowIso(now)
    if (grant.studentId && !repo.studentById(sql, grant.studentId)) {
      throw new AltamyraError('not_found', `student ${grant.studentId} not found`)
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
    if (!shapeOk) throw new AltamyraError('bad_request', `a ${role} grant has the wrong scope fields`)
    if (classId && !repo.classById(sql, classId)) throw new AltamyraError('not_found', `class ${classId} not found`)

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

/** GET /admin/schools/:id/memberships: every role holder in the school, for the Roles page. */
export const membershipsList = defineOp({
  name: 'memberships.list',
  room: 'school',
  args: z.object({ schoolId: Id }),
  run(sql, { schoolId }, actor): { memberships: { userId: string; displayName: string; role: MembershipRole | 'parent'; studentId: string | null; classId: string | null }[] } {
    authorize(actor, 'membership.manage', null, { schoolId })
    const name = (id: string) => repo.userById(sql, id)?.displayName ?? 'Unknown'
    const staff = repo.listMemberships(sql).map((m) => ({ userId: m.userId, displayName: name(m.userId), role: m.role, studentId: m.studentId, classId: m.classId }))
    const parents = repo.listParentLinks(sql).map((p) => ({ userId: p.parentUserId, displayName: name(p.parentUserId), role: 'parent' as const, studentId: p.studentId, classId: null }))
    return { memberships: [...staff, ...parents] }
  },
})

// ---------- roster, classes, schedule (reads used by the API) ----------

export const studentsGet = defineOp({
  name: 'students.get',
  room: 'school',
  args: z.object({ studentId: Id }),
  run(sql, args) {
    const student = repo.studentById(sql, args.studentId)
    if (!student) throw new AltamyraError('not_found', `student ${args.studentId} not found`)
    return { student, classIds: repo.classesOfStudent(sql, args.studentId) }
  },
})

export const classesList = defineOp({
  name: 'classes.list',
  room: 'school',
  args: z.object({}),
  run: (sql) => ({ classes: repo.listClasses(sql) }),
})

export const rosterList = defineOp({
  name: 'roster.list',
  room: 'school',
  args: z.object({ classId: Id }),
  run: (sql, args) => ({ studentIds: repo.rosterOf(sql, args.classId) }),
})

// ---------- lessons (PRD 1A-1, 1A-2) ----------

export const lessonsCreate = defineOp({
  name: 'lessons.create',
  room: 'school',
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
      throw new AltamyraError('bad_request', 'text lessons need text, files need file')
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

// ---------- sheet codes (PRD principle 3: codes identify student, lesson and check without a name) ----------

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `AL-${[...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`
}

export const sheetCodesIssue = defineOp({
  name: 'sheetCodes.issue',
  room: 'school',
  args: z.object({ studentId: Id, lessonId: Id, checkId: Id, now: z.string().optional() }),
  run(sql, args, actor): { sheetCode: SheetCode } {
    // PRD matrix "Augment lessons": EAs and parents view approved materials, so readers get codes already issued;
    // only write access issues a new one.
    authorize(actor, 'lesson_plan.edit', args.studentId, { access: 'read' })
    if (!repo.studentById(sql, args.studentId)) throw new AltamyraError('not_found', `student ${args.studentId} not found`)
    mustFind(sql, 'lessons', LessonSchema, args.lessonId)
    const existing = repo.findSheetCode(sql, args.studentId, args.lessonId, args.checkId)
    if (existing) return { sheetCode: existing }
    authorize(actor, 'lesson_plan.edit', args.studentId)
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
  args: z.object({ code: z.string().min(1) }),
  run(sql, args, actor): { sheetCode: SheetCode; classId: string | null } {
    const sheetCode = repo.sheetCodeByCode(sql, args.code.trim().toUpperCase())
    if (!sheetCode) throw new AltamyraError('not_found', 'unknown sheet code')
    authorizeStaff(actor, 'evidence.capture', sheetCode.studentId)
    // The lesson's class goes on the data point (PRD 1B "Timeline persistence").
    const classId = sql.get<{ class_id: string }>('SELECT class_id FROM lessons WHERE id = ?', sheetCode.lessonId)?.class_id ?? null
    return { sheetCode, classId }
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
    if (seeded && seeded.n > 0) throw new AltamyraError('bad_request', 'school room is already seeded')
    seedSchool(sql)
    seedSchoolDemo(sql, nowIso())
    return {
      schoolId: SCHOOL.id,
      districtId: DISTRICT.id,
      studentIds: Object.values(STUDENT_IDS),
      userIds: { ...USER_IDS } as Record<string, string>,
    }
  },
})

export const schoolOpList = [
  membershipsAssign,
  membershipsList,
  studentsGet,
  classesList,
  rosterList,
  lessonsCreate,
  sheetCodesIssue,
  sheetCodesResolve,
  meOverview,
  schoolDevSeed,
]
