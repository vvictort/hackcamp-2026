import { LessonPlan, Ticket } from '../contract/plans'
import {
  CaptureBatch,
  Lesson,
  Membership,
  ParentLink,
  ScheduleBlock,
  SchoolClass,
  SchoolStudent,
  SheetCode,
  User,
} from '../contract/school'
import type { SqlExecutor } from '../contract/ops'
import { findById, parseRow, parseRows } from './base'

type Row = Record<string, unknown>

export const userById = (sql: SqlExecutor, id: string) => findById(sql, 'users', User, id)
export const studentById = (sql: SqlExecutor, id: string) => findById(sql, 'students', SchoolStudent, id)
export const classById = (sql: SqlExecutor, id: string) => findById(sql, 'classes', SchoolClass, id)
export const captureBatchById = (sql: SqlExecutor, id: string) => findById(sql, 'capture_batches', CaptureBatch, id)

export function listStudents(sql: SqlExecutor): SchoolStudent[] {
  return parseRows(SchoolStudent, sql.all<Row>('SELECT * FROM students ORDER BY display_token'))
}

export function listClasses(sql: SqlExecutor): SchoolClass[] {
  return parseRows(SchoolClass, sql.all<Row>('SELECT * FROM classes ORDER BY rowid'))
}

export function rosterOf(sql: SqlExecutor, classId: string): string[] {
  return sql.all<{ student_id: string }>('SELECT student_id FROM roster WHERE class_id = ? ORDER BY rowid', classId).map((r) => r.student_id)
}

export function classesOfStudent(sql: SqlExecutor, studentId: string): string[] {
  return sql.all<{ class_id: string }>('SELECT class_id FROM roster WHERE student_id = ? ORDER BY rowid', studentId).map((r) => r.class_id)
}

export function blocksForWeekday(sql: SqlExecutor, weekday: number): ScheduleBlock[] {
  return parseRows(ScheduleBlock, sql.all<Row>('SELECT * FROM schedule_blocks WHERE weekday = ? ORDER BY starts_at, rowid', weekday))
}

export function membershipsOf(sql: SqlExecutor, userId: string): Membership[] {
  return parseRows(Membership, sql.all<Row>('SELECT * FROM memberships WHERE user_id = ? ORDER BY rowid', userId))
}

export function findMembership(
  sql: SqlExecutor,
  m: Pick<Membership, 'userId' | 'role' | 'studentId' | 'classId'>,
): Membership | undefined {
  const row = sql.get<Row>(
    "SELECT * FROM memberships WHERE user_id = ? AND role = ? AND IFNULL(student_id, '') = ? AND IFNULL(class_id, '') = ?",
    m.userId,
    m.role,
    m.studentId ?? '',
    m.classId ?? '',
  )
  return row ? parseRow(Membership, row) : undefined
}

export function parentLinksOf(sql: SqlExecutor, parentUserId: string): ParentLink[] {
  return parseRows(ParentLink, sql.all<Row>('SELECT * FROM parent_links WHERE parent_user_id = ? ORDER BY rowid', parentUserId))
}

export function findParentLink(sql: SqlExecutor, parentUserId: string, studentId: string): ParentLink | undefined {
  const row = sql.get<Row>('SELECT * FROM parent_links WHERE parent_user_id = ? AND student_id = ?', parentUserId, studentId)
  return row ? parseRow(ParentLink, row) : undefined
}

export function lessonsOn(sql: SqlExecutor, classId: string, date: string): Lesson[] {
  return parseRows(Lesson, sql.all<Row>('SELECT * FROM lessons WHERE class_id = ? AND scheduled_for = ? ORDER BY created_at, rowid', classId, date))
}

export function sheetCodeByCode(sql: SqlExecutor, code: string): SheetCode | undefined {
  const row = sql.get<Row>('SELECT * FROM sheet_codes WHERE code = ?', code)
  return row ? parseRow(SheetCode, row) : undefined
}

export function findSheetCode(sql: SqlExecutor, studentId: string, lessonId: string, checkId: string): SheetCode | undefined {
  const row = sql.get<Row>(
    'SELECT * FROM sheet_codes WHERE student_id = ? AND lesson_id = ? AND check_id = ?',
    studentId,
    lessonId,
    checkId,
  )
  return row ? parseRow(SheetCode, row) : undefined
}

export function listMemberships(sql: SqlExecutor): Membership[] {
  return parseRows(Membership, sql.all<Row>('SELECT * FROM memberships ORDER BY rowid'))
}

export function listParentLinks(sql: SqlExecutor): ParentLink[] {
  return parseRows(ParentLink, sql.all<Row>('SELECT * FROM parent_links ORDER BY rowid'))
}

// ---------- lesson plans and IEP change tickets ----------

export const lessonPlanById = (sql: SqlExecutor, id: string) => findById(sql, 'lesson_plans', LessonPlan, id)
export const ticketById = (sql: SqlExecutor, id: string) => findById(sql, 'iep_change_tickets', Ticket, id)

/** Plans of one student on a day, newest first. */
export function plansForStudentOn(sql: SqlExecutor, studentId: string, date: string): LessonPlan[] {
  return parseRows(
    LessonPlan,
    sql.all<Row>('SELECT * FROM lesson_plans WHERE student_id = ? AND plan_date = ? ORDER BY created_at DESC, rowid DESC', studentId, date),
  )
}

export function ticketsForStudent(sql: SqlExecutor, studentId: string): Ticket[] {
  return parseRows(Ticket, sql.all<Row>('SELECT * FROM iep_change_tickets WHERE student_id = ? ORDER BY created_at DESC, rowid DESC', studentId))
}

export function ticketsByStatus(sql: SqlExecutor, status: 'pending' | 'all'): Ticket[] {
  const where = status === 'pending' ? "WHERE status = 'pending' " : ''
  return parseRows(Ticket, sql.all<Row>(`SELECT * FROM iep_change_tickets ${where}ORDER BY created_at DESC, rowid DESC`))
}
