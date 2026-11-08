import { z } from 'zod'
import { DateString, ExpectedVersion, Id, MediaRef, TimeOfDay, Timestamp } from './common'
import {
  AdaptationType,
  ConsentKind,
  DecisionRule,
  EventKind,
  LessonSourceKind,
  MembershipRole,
  MetricType,
  PromptLevel,
  Proficiency,
  SummaryKind,
} from './enums'
import { InsightDimension } from './insights'
import { CaptureBatch, Lesson, LessonAnalysis, Membership, ParentLink } from './school'
import {
  AnswerKeyEntry,
  Check,
  CheckItem,
  Consent,
  DataPoint,
  Decision,
  DayReview,
  FamilySummary,
  Goal,
  IepSections,
  IepVersion,
  LensRun,
  Objective,
  ProficiencyRating,
  ReviewItem,
  Note,
  Suggestion,
  Summary,
  Video,
} from './student'
import { ProposeObjectivesOutput } from './ai'

/**
 * Request and response bodies for every route under /api/v1 (design doc
 * "API routes"). Names: <Area><Action>Body for requests, ...Response for
 * responses, ...Query for query strings. Errors use ErrorBody (errors.ts).
 *
 * Routes whose path has no student id (/objectives/:oid, /suggestions/:sgid,
 * /data-points/:dpid, /review-queue/:rid, /family-summaries/:fsid,
 * /goals/:gid) take ?studentId= (StudentRefQuery) so the
 * router can check scope and reach the right student room.
 */

export const StudentRefQuery = z.object({ studentId: Id })
export type StudentRefQuery = z.infer<typeof StudentRefQuery>

export const OkResponse = z.object({ ok: z.literal(true) })

// ---------- Me (M0) ----------

export const StudentSummary = z.object({
  id: Id,
  displayToken: z.string(),
  /** Present only for actors allowed to see it (never for district or link actors). */
  firstName: z.string().nullable(),
  grade: z.string(),
  roles: z.array(z.enum(['case_manager', 'teacher', 'ea', 'parent'])),
})
export type StudentSummary = z.infer<typeof StudentSummary>

export const ScheduleItem = z.object({
  classId: Id,
  className: z.string(),
  subject: z.string(),
  startsAt: TimeOfDay,
  endsAt: TimeOfDay,
  studentIds: z.array(Id),
  lessonId: Id.nullable(),
  lessonTitle: z.string().nullable(),
})
export type ScheduleItem = z.infer<typeof ScheduleItem>

export const MeResponse = z.object({
  userId: Id,
  displayName: z.string().nullable(),
  memberships: z.array(Membership.pick({ role: true, studentId: true, classId: true, districtId: true })),
  caseload: z.array(StudentSummary),
  students: z.array(StudentSummary),
  classes: z.array(z.object({ id: Id, name: z.string(), subject: z.string(), grade: z.string() })),
  todaySchedule: z.array(ScheduleItem),
  parentOf: z.array(Id),
})
export type MeResponse = z.infer<typeof MeResponse>

// ---------- Admin (M0) ----------

export const AdminMembershipBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('membership'),
    userId: Id,
    displayName: z.string().min(1),
    role: MembershipRole,
    studentId: Id.nullable().default(null),
    classId: Id.nullable().default(null),
    districtId: Id.nullable().default(null),
  }),
  z.object({ kind: z.literal('parent_link'), userId: Id, displayName: z.string().min(1), studentId: Id }),
])
export type AdminMembershipBody = z.infer<typeof AdminMembershipBody>

/** GET /admin/schools/:id/memberships: who holds which role, for the school administrator's Roles page. */
export const AdminMembershipsListResponse = z.object({
  memberships: z.array(
    z.object({
      userId: Id,
      displayName: z.string(),
      role: z.enum(['case_manager', 'teacher', 'ea', 'parent', 'school_admin', 'district_lead']),
      studentId: Id.nullable(),
      classId: Id.nullable(),
    }),
  ),
})
export type AdminMembershipsListResponse = z.infer<typeof AdminMembershipsListResponse>

export const AdminMembershipResponse = z.object({
  membership: Membership.nullable(),
  parentLink: ParentLink.nullable(),
})

export const DevSeedResponse = z.object({
  schoolId: Id,
  districtId: Id,
  studentIds: z.array(Id),
  userIds: z.record(z.string(), Id),
})
export type DevSeedResponse = z.infer<typeof DevSeedResponse>

// ---------- Students (M0) ----------

/** GET /students/:id, shaped by the caller's DataFilter. */
export const StudentProfileResponse = z.discriminatedUnion('view', [
  z.object({
    view: z.literal('full'),
    id: Id,
    displayToken: z.string(),
    grade: z.string(),
    iepVersion: z.number().int().nullable(),
    sections: IepSections.nullable(),
    modificationSubjects: z.array(z.string()),
    goals: z.array(Goal),
  }),
  /** EA (supports and what works) and student mode (supports applied): no IEP text, accommodations included. */
  z.object({
    view: z.literal('supports'),
    id: Id,
    firstName: z.string().nullable(),
    supports: z.array(z.string()),
  }),
])
export type StudentProfileResponse = z.infer<typeof StudentProfileResponse>

// ---------- IEP import (M2) ----------

export const IepImportBody = z
  .object({
    sourceKind: z.enum(['pdf', 'text']),
    file: MediaRef.nullable().default(null),
    text: z.string().nullable().default(null),
  })
  .refine((b) => (b.sourceKind === 'pdf' ? b.file !== null : b.text !== null), 'pdf needs file, text needs text')
export type IepImportBody = z.infer<typeof IepImportBody>

export const IepImportResponse = z.object({
  iep: IepVersion,
  goals: z.array(Goal),
  /** One proposal per goal, for side-by-side confirmation. */
  objectiveProposals: z.array(ProposeObjectivesOutput),
})
export type IepImportResponse = z.infer<typeof IepImportResponse>

export const IepConfirmBody = ExpectedVersion.extend({
  /** Case-manager corrections made during side-by-side review. */
  sections: IepSections.optional(),
  modificationSubjects: z.array(z.string()).optional(),
})
export type IepConfirmBody = z.infer<typeof IepConfirmBody>

export const IepConfirmResponse = z.object({ iep: IepVersion, goals: z.array(Goal), objectives: z.array(Objective) })

// ---------- Objectives (M2) ----------

export const ObjectivesResponse = z.object({ objectives: z.array(Objective) })

export const ObjectiveConfirmBody = ExpectedVersion.extend({
  edits: Objective.pick({
    metricType: true,
    unit: true,
    baseline: true,
    target: true,
    masteryRule: true,
    reviewDate: true,
    captureMethod: true,
  })
    .partial()
    .optional(),
})
export type ObjectiveConfirmBody = z.infer<typeof ObjectiveConfirmBody>

export const ObjectiveFlagBody = ExpectedVersion.extend({ reason: z.string().min(1) })
export type ObjectiveFlagBody = z.infer<typeof ObjectiveFlagBody>

export const ObjectiveResponse = z.object({ objective: Objective })

// ---------- Lessons (M1) ----------

export const LessonCreateBody = z
  .object({
    title: z.string().min(1),
    sourceKind: LessonSourceKind,
    text: z.string().nullable().default(null),
    file: MediaRef.nullable().default(null),
    scheduledFor: DateString.nullable().default(null),
  })
  .refine((b) => (b.sourceKind === 'text' ? b.text !== null : b.file !== null), 'text lessons need text, files need file')
export type LessonCreateBody = z.infer<typeof LessonCreateBody>

export const LessonResponse = z.object({ lesson: Lesson })
export const LessonAnalysisResponse = z.object({ analysis: LessonAnalysis })

// ---------- Lens (M1) ----------

export const LensRunBody = z.object({
  /** Defaults to every IEP student in the class. */
  studentIds: z.array(Id).optional(),
})
export type LensRunBody = z.infer<typeof LensRunBody>

export const LensStudentResult = z.object({
  studentId: Id,
  lensRun: LensRun,
  suggestions: z.array(Suggestion),
  checks: z.array(Check),
})
export type LensStudentResult = z.infer<typeof LensStudentResult>

export const LensRunResponse = z.object({ analysisId: Id, results: z.array(LensStudentResult) })
export const LensStudentResponse = LensStudentResult

// ---------- Suggestions (M1) ----------

export const SuggestionApproveBody = ExpectedVersion
export const SuggestionEditBody = ExpectedVersion.extend({
  content: z.object({ title: z.string().min(1), text: z.string().min(1), why: z.string() }).partial(),
  goalIds: z.array(Id).min(1).optional(),
})
export type SuggestionEditBody = z.infer<typeof SuggestionEditBody>
export const SuggestionRegenerateBody = ExpectedVersion.extend({ instruction: z.string().nullable().default(null) })
export const SuggestionRejectBody = ExpectedVersion.extend({ reason: z.string().nullable().default(null) })

export const SuggestionResponse = z.object({
  suggestion: Suggestion,
  /** Set when approval logged "adaptation used" (PRD 1A-7). */
  usageEventId: Id.nullable(),
})
export type SuggestionResponse = z.infer<typeof SuggestionResponse>

export const BulkApproveBody = z.object({
  items: z.array(z.object({ suggestionId: Id, expectedVersion: z.number().int().min(1) })).min(1),
})
export type BulkApproveBody = z.infer<typeof BulkApproveBody>

export const BulkApproveResponse = z.object({
  approved: z.array(Id),
  /** Modifications the IEP does not authorize stay blocked (PRD 1A-5). */
  blocked: z.array(Id),
  conflicts: z.array(Id),
})

// ---------- Sheets (M1) ----------

export const SheetPage = z.object({
  sheetCode: z.string(),
  studentToken: z.string(),
  adaptations: z.array(z.object({ suggestionId: Id, title: z.string(), text: z.string() })),
  checkItems: z.array(CheckItem),
})

/** POST /checks/:chid/remove?studentId= (PRD 1A-6: the teacher can remove checks). */
export const CheckRemoveBody = ExpectedVersion
export const CheckResponse = z.object({ check: Check })

export const SheetResponse = z.object({
  lessonId: Id,
  pages: z.array(SheetPage),
  /** Printed separately from student pages. */
  answerKey: z.array(z.object({ sheetCode: z.string(), entries: z.array(AnswerKeyEntry) })),
})
export type SheetResponse = z.infer<typeof SheetResponse>

// ---------- Photo capture (M2) ----------

export const PhotoCaptureBody = z.object({ pages: z.array(MediaRef).min(1) })
export type PhotoCaptureBody = z.infer<typeof PhotoCaptureBody>
export const CaptureBatchResponse = z.object({ batch: CaptureBatch })

// ---------- EA capture (M2) ----------

const EventBase = z.object({
  objectiveId: Id,
  classId: Id.nullable().default(null),
  lessonId: Id.nullable().default(null),
  recordedAt: Timestamp.optional(),
})

export const CaptureEventBody = z.discriminatedUnion('kind', [
  EventBase.extend({ kind: z.literal('prompt_level'), promptLevel: PromptLevel }),
  EventBase.extend({ kind: z.literal('counter'), count: z.number().int().min(0) }),
  EventBase.extend({ kind: z.literal('timer'), durationSeconds: z.number().min(0) }),
])
export type CaptureEventBody = z.infer<typeof CaptureEventBody>

export const CaptureEventResponse = z.object({ dataPoint: DataPoint })

export const VoiceNoteBody = z.object({
  audio: MediaRef,
  classId: Id.nullable().default(null),
  recordedAt: Timestamp.optional(),
})
export type VoiceNoteBody = z.infer<typeof VoiceNoteBody>

export const VoiceNoteResponse = z.object({
  dataPoints: z.array(DataPoint),
  /** Always true on success: the recording is deleted once converted (PRD consent NFR). */
  audioDeleted: z.literal(true),
})

// ---------- Review queue (M2) ----------

export const ReviewQueueResponse = z.object({
  items: z.array(z.object({ studentId: Id, item: ReviewItem, dataPoint: DataPoint })),
})

export const ReviewConfirmBody = ExpectedVersion.extend({
  /** Set to confirm with a corrected value (creates a new data point version). */
  value: z.number().optional(),
})
export type ReviewConfirmBody = z.infer<typeof ReviewConfirmBody>

export const DataPointCorrectBody = ExpectedVersion.extend({ value: z.number(), reason: z.string().min(1) })
export type DataPointCorrectBody = z.infer<typeof DataPointCorrectBody>

export const DataPointResponse = z.object({ dataPoint: DataPoint })

// ---------- Timeline (M2) ----------

export const TimelineQuery = z.object({
  from: Timestamp.optional(),
  to: Timestamp.optional(),
  objectiveId: Id.optional(),
})
export type TimelineQuery = z.infer<typeof TimelineQuery>

export const TimelineResponse = z.object({ dataPoints: z.array(DataPoint), decisions: z.array(Decision) })

export const GoalStatusResponse = z.object({
  goalId: Id,
  objectiveId: Id.nullable(),
  metricType: MetricType.nullable(),
  baseline: z.number().nullable(),
  current: z.number().nullable(),
  target: z.number().nullable(),
  trend: z.number().nullable(),
  projectedDate: DateString.nullable(),
  recentCount: z.number().int().min(0),
  canShowTrend: z.boolean(),
  latestDecision: DecisionRule.nullable(),
})
export type GoalStatusResponse = z.infer<typeof GoalStatusResponse>

export const DataPointSourceResponse = z.object({
  dataPoint: DataPoint,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('photo'), fileKey: z.string(), itemId: z.string().nullable() }),
    /** @deprecated removed feature (student mode); never produced. Kept so the frontend keeps compiling. */
    z.object({ kind: z.literal('student_response'), sessionId: Id, itemId: z.string() }),
    z.object({ kind: z.literal('ea_event'), eventKind: EventKind }),
    z.object({ kind: z.literal('usage'), suggestionId: Id }),
    z.object({ kind: z.literal('teacher'), note: z.string().nullable() }),
  ]),
})

// ---------- Insight (M3) ----------

export const AimlineResponse = z.object({
  start: z.object({ date: DateString, value: z.number() }).nullable(),
  end: z.object({ date: DateString, value: z.number() }).nullable(),
  points: z.array(z.object({ id: Id, date: Timestamp, value: z.number() })),
})

export const WhatWorksResponse = z.object({
  rows: z.array(
    z.object({
      adaptationType: AdaptationType,
      n: z.number().int().min(0),
      meanOutcome: z.number().nullable(),
      /** Hidden below the minimum count. */
      hidden: z.boolean(),
    }),
  ),
})

// ---------- Proficiency (M3) ----------

export const ProficiencySetBody = z.object({
  level: Proficiency,
  period: z.string().min(1),
  narrative: z.string().nullable().default(null),
})
export type ProficiencySetBody = z.infer<typeof ProficiencySetBody>
export const ProficiencyResponse = z.object({ rating: ProficiencyRating })

// ---------- Families and summaries ----------

/** @deprecated removed feature (GET /family/:id/progress has no route; parents read FamilySummariesResponse). Kept so the frontend keeps compiling. */
export const FamilyProgressResponse = z.object({
  goals: z.array(
    z.object({
      goal: Goal.pick({ id: true, area: true, text: true }),
      /** Confirmed and auto-confirmed points only (PRD "Parents see only confirmed data"). */
      dataPoints: z.array(DataPoint),
    }),
  ),
  summaries: z.array(FamilySummary),
  lessons: z.array(z.object({ lessonId: Id, title: z.string(), adaptations: z.array(z.object({ title: z.string(), text: z.string() })) })),
})

export const FamilyConsentBody = z.object({ kind: ConsentKind, granted: z.boolean() })
export type FamilyConsentBody = z.infer<typeof FamilyConsentBody>
export const FamilyConsentsResponse = z.object({ consents: z.array(Consent) })

// ---------- Summaries (daily, weekly, monthly) ----------

export const SummaryGenerateBody = z.object({
  kind: SummaryKind,
  /** YYYY-MM-DD, YYYY-Www or YYYY-MM by kind; defaults to today, this week or this month. */
  period: z.string().optional(),
  /** Monthly only: BCP 47 tag of the family's language; defaults to English. */
  language: z.string().min(2).max(16).optional(),
})
export type SummaryGenerateBody = z.infer<typeof SummaryGenerateBody>

export const SummaryPatchBody = z.object({
  studentId: Id,
  text: z.string().trim().min(1).max(8000),
  translatedText: z.string().trim().min(1).max(8000).nullable().optional(),
  /** Language of translatedText when the translation is written or fixed by hand. */
  language: z.string().min(2).max(16).optional(),
  version: z.number().int().min(1),
})
export const SummaryApproveBody = z.object({ studentId: Id, version: z.number().int().min(1) })
export const SummaryResponse = z.object({ summary: Summary })
/** GET /students/:id/summaries and GET /family/:id/summaries. The room filters by role: EA and teacher see drafts, the case manager approved weekly, the parent approved monthly. */
export const SummariesResponse = z.object({ summaries: z.array(Summary) })
export const SummariesQuery = z.object({ kind: SummaryKind.optional() })
/** @deprecated use SummariesResponse. */
export const FamilySummariesResponse = SummariesResponse
export const PendingSummariesResponse = z.object({
  summaries: z.array(z.object({ id: Id, studentId: Id, label: z.string(), kind: SummaryKind, period: z.string() })),
})
export const WeeklySummariesResponse = z.object({
  summaries: z.array(z.object({ id: Id, studentId: Id, label: z.string(), period: z.string(), text: z.string(), approvedAt: Timestamp.nullable() })),
})

// ---------- Daily record ----------

export const NoteBody = z.object({ objectiveId: Id.nullable().optional(), text: z.string().trim().min(1).max(2000) })
export const NoteResponse = z.object({ note: Note })
/** Upload first (same storage pattern as voice notes), then register the file here. */
export const VideoBody = z.object({
  fileKey: z.string().min(1),
  contentType: z.string().regex(/^video\//, 'contentType must be video/*'),
  sizeBytes: z.number().int().min(0).max(500 * 1024 * 1024),
  objectiveId: Id.nullable().optional(),
  recordedAt: Timestamp.optional(),
})
export const VideoResponse = z.object({ video: Video })

export const DayCountsSchema = z.object({
  dataPoints: z.number().int(),
  events: z.number().int(),
  notes: z.number().int(),
  videos: z.number().int(),
  voiceNotes: z.number().int(),
})
export const DaysQuery = z.object({ from: DateString.optional(), to: DateString.optional() })
export const DaysResponse = z.object({
  days: z.array(z.object({ date: DateString, counts: DayCountsSchema, reviewed: z.boolean() })),
})
export const DayDetailResponse = z.object({
  date: DateString,
  dataPoints: z.array(DataPoint),
  events: z.array(DataPoint),
  notes: z.array(Note),
  videos: z.array(Video),
  voiceNotes: z.array(DataPoint),
  review: DayReview.nullable(),
  dailySummary: Summary.nullable(),
})
export const DayCompleteBody = z.object({ note: z.string().trim().max(2000).nullable().optional() })
export const DayCompleteResponse = z.object({ review: DayReview, dailySummary: Summary.nullable() })
export const MyDayReviewResponse = z.object({
  date: DateString,
  students: z.array(z.object({ studentId: Id, label: z.string(), entriesToday: z.number().int(), reviewed: z.boolean() })),
})

// ---------- Insights (M5) ----------

export const InsightsQuery = z.object({
  period: z.string().optional(),
  groupBy: z.array(InsightDimension).min(1).default(['goalArea']),
})
export type InsightsQuery = z.infer<typeof InsightsQuery>

export const InsightsResponse = z.object({
  /** Deterministic text built from the aggregates (not AI); never mentions suppressed groups or students. */
  monthlyNarrative: z.object({ period: z.string().nullable(), text: z.string() }),
  groups: z.array(
    z.object({
      dims: z.record(z.string(), z.string().nullable()),
      /** null when suppressed (fewer than MIN_GROUP_SIZE students). */
      students: z.number().int().nullable(),
      count: z.number().int().nullable(),
      suppressed: z.boolean(),
    }),
  ),
})
export type InsightsResponse = z.infer<typeof InsightsResponse>
