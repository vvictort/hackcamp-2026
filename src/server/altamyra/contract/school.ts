import { z } from 'zod'
import { DateString, Id, RowVersion, TimeOfDay, Timestamp } from './common'
import { CaptureBatchStatus, LessonSourceKind, MembershipRole } from './enums'

/** Entities stored in AltamyraSchoolRoom (one room per school). Same naming rules as student.ts. */

export const User = z.object({
  /** DeepSpace userId from resolveAuth. */
  id: Id,
  displayName: z.string().min(1),
  createdAt: Timestamp,
})
export type User = z.infer<typeof User>

/**
 * One role grant. Case manager and EA grants name a student; teacher grants
 * name a class (the teacher's students are that class's roster); school_admin
 * and district_lead name neither (districtId is set for district_lead).
 */
export const Membership = z.object({
  id: Id,
  userId: Id,
  role: MembershipRole,
  studentId: Id.nullable(),
  classId: Id.nullable(),
  districtId: Id.nullable(),
  createdAt: Timestamp,
  version: RowVersion,
})
export type Membership = z.infer<typeof Membership>

export const ParentLink = z.object({
  id: Id,
  parentUserId: Id,
  studentId: Id,
  createdAt: Timestamp,
})
export type ParentLink = z.infer<typeof ParentLink>

/** Roster entry. No names: the student's name lives only in their own room's IEP. */
export const SchoolStudent = z.object({
  id: Id,
  /** Opaque token used on sheets, in AI calls and in insights, e.g. "S-7Q4K". */
  displayToken: z.string().min(1),
  grade: z.string().min(1),
  createdAt: Timestamp,
  version: RowVersion,
})
export type SchoolStudent = z.infer<typeof SchoolStudent>

export const SchoolClass = z.object({
  id: Id,
  name: z.string().min(1),
  /** Subject key matched against IepVersion.modificationSubjects, e.g. "math". */
  subject: z.string().min(1),
  grade: z.string().min(1),
  version: RowVersion,
})
export type SchoolClass = z.infer<typeof SchoolClass>

export const RosterEntry = z.object({
  classId: Id,
  studentId: Id,
})
export type RosterEntry = z.infer<typeof RosterEntry>

/** Weekly recurring block. weekday: 1 = Monday ... 5 = Friday. */
export const ScheduleBlock = z.object({
  id: Id,
  classId: Id,
  weekday: z.number().int().min(0).max(6),
  startsAt: TimeOfDay,
  endsAt: TimeOfDay,
  version: RowVersion,
})
export type ScheduleBlock = z.infer<typeof ScheduleBlock>

export const Lesson = z.object({
  id: Id,
  classId: Id,
  title: z.string().min(1),
  sourceKind: LessonSourceKind,
  /** Extracted or pasted lesson text. */
  text: z.string().nullable(),
  scheduledFor: DateString.nullable(),
  createdBy: Id,
  createdAt: Timestamp,
  version: RowVersion,
})
export type Lesson = z.infer<typeof Lesson>

export const LessonFile = z.object({
  id: Id,
  lessonId: Id,
  storageKey: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  createdAt: Timestamp,
})
export type LessonFile = z.infer<typeof LessonFile>

/** PRD 1A-2 analysis fields. */
export const LessonAnalysisBody = z.object({
  objectives: z.array(z.string()),
  readingLevel: z.string(),
  writingLoad: z.enum(['low', 'medium', 'high']),
  modality: z.array(z.string()),
  competencies: z.array(z.string()),
})
export type LessonAnalysisBody = z.infer<typeof LessonAnalysisBody>


/** Printed sheet code: maps to student, lesson and check without a name. */
export const SheetCode = z.object({
  code: z.string().min(1),
  studentId: Id,
  lessonId: Id,
  checkId: Id,
  createdAt: Timestamp,
})
export type SheetCode = z.infer<typeof SheetCode>

export const CapturePageResult = z.object({
  fileKey: z.string().min(1),
  sheetCode: z.string().nullable(),
  studentId: Id.nullable(),
  status: z.enum(['scored', 'unreadable_code', 'failed']),
  dataPointIds: z.array(Id),
})
export type CapturePageResult = z.infer<typeof CapturePageResult>

/** A photographed stack of sheets (POST /captures/photos). */
export const CaptureBatch = z.object({
  id: Id,
  createdBy: Id,
  createdAt: Timestamp,
  status: CaptureBatchStatus,
  pages: z.array(CapturePageResult),
  version: RowVersion,
})
export type CaptureBatch = z.infer<typeof CaptureBatch>

