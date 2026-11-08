import {
  CaptureBatch,
  Lesson,
  LessonAnalysis,
  LessonFile,
  Membership,
  ParentLink,
  ScheduleBlock,
  SchoolClass,
  SchoolStudent,
  SheetCode,
  ShareToken,
  User,
} from '../contract/school'
import type { SqlExecutor } from '../db/sql'
import { findById, parseRow, parseRows } from './base'

type Row = Record<string, unknown>

export const userById = (sql: SqlExecutor, id: string) => findById(sql, 'users', User, id)
export const studentById = (sql: SqlExecutor, id: string) => findById(sql, 'students', SchoolStudent, id)
export const classById = (sql: SqlExecutor, id: string) => findById(sql, 'classes', SchoolClass, id)
export const lessonById = (sql: SqlExecutor, id: string) => findById(sql, 'lessons', Lesson, id)
export const shareTokenById = (sql: SqlExecutor, id: string) => findById(sql, 'share_tokens', ShareToken, id)
export const captureBatchById = (sql: SqlExecutor, id: string) => findById(sql, 'capture_batches', CaptureBatch, id)

export function listStudents(sql: SqlExecutor): SchoolStudent[] {
  return parseRows(SchoolStudent, sql.all<Row>('SELECT * FROM students ORDER BY rowid'))
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

export function listSchedule(sql: SqlExecutor, classId?: string): ScheduleBlock[] {
  return parseRows(
    ScheduleBlock,
    classId
      ? sql.all<Row>('SELECT * FROM schedule_blocks WHERE class_id = ? ORDER BY weekday, starts_at', classId)
      : sql.all<Row>('SELECT * FROM schedule_blocks ORDER BY weekday, starts_at'),
  )
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

export function filesOfLesson(sql: SqlExecutor, lessonId: string): LessonFile[] {
  return parseRows(LessonFile, sql.all<Row>('SELECT * FROM lesson_files WHERE lesson_id = ? ORDER BY rowid', lessonId))
}

export function analysisOfLesson(sql: SqlExecutor, lessonId: string): LessonAnalysis | undefined {
  const row = sql.get<Row>('SELECT * FROM lesson_analyses WHERE lesson_id = ?', lessonId)
  return row ? parseRow(LessonAnalysis, row) : undefined
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

export function shareTokenByHash(sql: SqlExecutor, tokenHash: string): ShareToken | undefined {
  const row = sql.get<Row>('SELECT * FROM share_tokens WHERE token_hash = ?', tokenHash)
  return row ? parseRow(ShareToken, row) : undefined
}
