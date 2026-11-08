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
  ProposalTarget,
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
  DraftSentence,
  FamilySummary,
  Goal,
  Handoff,
  IepSections,
  IepVersion,
  LensRun,
  Objective,
  ParentInput,
  ProficiencyRating,
  ProgressDraft,
  Proposal,
  ReviewItem,
  Suggestion,
} from './student'
import { ProposeObjectivesOutput } from './ai'

/**
 * Request and response bodies for every route under /api/v1 (design doc
 * "API routes"). Names: <Area><Action>Body for requests, ...Response for
 * responses, ...Query for query strings. Errors use ErrorBody (errors.ts).
 *
 * Routes whose path has no student id (/objectives/:oid, /suggestions/:sgid,
 * /data-points/:dpid, /review-queue/:rid, /drafts/:did, /family-summaries/:fsid,
 * /goals/:gid, /proposals/:pid) take ?studentId= (StudentRefQuery) so the
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

// ---------- Proposals (M2) ----------

export const ProposalCreateBody = z.object({
  target: ProposalTarget,
  change: z.record(z.string(), z.unknown()),
  evidenceIds: z.array(Id).default([]),
})
export type ProposalCreateBody = z.infer<typeof ProposalCreateBody>

export const ProposalResolveBody = ExpectedVersion.extend({
  decision: z.enum(['accepted', 'declined']),
  note: z.string().nullable().default(null),
})
export type ProposalResolveBody = z.infer<typeof ProposalResolveBody>

export const ProposalResponse = z.object({ proposal: Proposal })
export const ProposalsResponse = z.object({ proposals: z.array(Proposal.extend({ studentId: Id })) })

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
    z.object({ kind: z.literal('student_response'), sessionId: Id, itemId: z.string() }),
    z.object({ kind: z.literal('ea_event'), eventKind: EventKind }),
    z.object({ kind: z.literal('usage'), suggestionId: Id }),
    z.object({ kind: z.literal('teacher'), note: z.string().nullable() }),
  ]),
})

// ---------- Student mode (M3) ----------

export const SessionCreateResponse = z.object({ sessionId: Id, token: z.string(), expiresAt: Timestamp })

export const SessionSupports = z.object({
  readAloud: z.boolean(),
  largerText: z.boolean(),
  fewerItems: z.boolean(),
  visualSupports: z.boolean(),
  breakTimerMinutes: z.number().int().positive().nullable(),
})
export type SessionSupports = z.infer<typeof SessionSupports>

/** Student mode never carries IEP text, other students or adult notes. */
export const SessionNextResponse = z.object({
  item: z.object({ itemId: z.string(), prompt: z.string(), format: CheckItem.shape.format, options: z.array(z.string()).nullable() }).nullable(),
  supports: SessionSupports,
})
export type SessionNextResponse = z.infer<typeof SessionNextResponse>

export const SessionResponseBody = z.object({
  itemId: z.string().min(1),
  response: z.string(),
  durationMs: z.number().int().min(0).optional(),
  /** Whether the student used read-aloud on this item (PRD 1B: student mode records read-aloud use). */
  readAloudUsed: z.boolean().default(false),
})
export type SessionResponseBody = z.infer<typeof SessionResponseBody>

export const SessionResponseResult = z.object({ correct: z.boolean() })

export const SessionProgressResponse = z.object({
  goals: z.array(z.object({ label: z.string(), completed: z.number().int().min(0), streak: z.number().int().min(0) })),
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

export const DigestResponse = z.object({
  items: z.array(z.object({ studentId: Id, decision: Decision })),
})

// ---------- Proficiency and drafts (M3) ----------

export const ProficiencySetBody = z.object({
  level: Proficiency,
  period: z.string().min(1),
  narrative: z.string().nullable().default(null),
})
export type ProficiencySetBody = z.infer<typeof ProficiencySetBody>
export const ProficiencyResponse = z.object({ rating: ProficiencyRating })

export const DraftCreateBody = z.object({
  goalId: Id,
  period: z.string().min(1),
  dueDate: DateString.nullable().default(null),
})
export type DraftCreateBody = z.infer<typeof DraftCreateBody>

export const DraftPatchBody = ExpectedVersion.extend({ sentences: z.array(DraftSentence) })
export type DraftPatchBody = z.infer<typeof DraftPatchBody>

export const DraftMarkUsedBody = ExpectedVersion
export const DraftResponse = z.object({ draft: ProgressDraft })

// ---------- Families (M4) ----------

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

export const FamilyInputBody = z.object({ text: z.string().min(1), language: z.string().min(2) })
export type FamilyInputBody = z.infer<typeof FamilyInputBody>
export const FamilyInputResponse = z.object({ input: ParentInput })
/** GET /students/:id/parent-input: what parents sent to the case manager. */
export const ParentInputsResponse = z.object({ inputs: z.array(ParentInput) })

export const FamilyConsentBody = z.object({ kind: ConsentKind, granted: z.boolean() })
export type FamilyConsentBody = z.infer<typeof FamilyConsentBody>
export const FamilyConsentsResponse = z.object({ consents: z.array(Consent) })

export const FamilySummaryCreateBody = z.object({ language: z.string().min(2) })
export const FamilySummaryApproveBody = ExpectedVersion.extend({ text: z.string().min(1).optional() })
export const FamilySummaryResponse = z.object({ summary: FamilySummary })

// ---------- Today View (M4) ----------

export const TodayLinkBody = z.object({ ttlHours: z.number().positive().max(24).default(12) })
export type TodayLinkBody = z.infer<typeof TodayLinkBody>
export const TodayLinkResponse = z.object({ token: z.string(), expiresAt: Timestamp })

/** GET /today/:token: supports and approved adaptations only, no IEP text. */
export const TodayViewResponse = z.object({
  firstName: z.string().nullable(),
  expiresAt: Timestamp,
  supports: z.array(z.string()),
  approvedAdaptations: z.array(z.object({ title: z.string(), text: z.string(), lessonTitle: z.string().nullable() })),
  whatWorks: z.array(z.object({ adaptationType: AdaptationType, n: z.number().int() })),
  schedule: z.array(ScheduleItem.pick({ className: true, startsAt: true, endsAt: true })),
})
export type TodayViewResponse = z.infer<typeof TodayViewResponse>

// ---------- Handoff (M4) ----------

export const HandoffCreateBody = z.object({ toSchool: z.string().nullable().default(null) })
export const HandoffResponse = z.object({ handoff: Handoff })

// ---------- Insights (M5) ----------

export const InsightsQuery = z.object({
  period: z.string().optional(),
  groupBy: z.array(InsightDimension).min(1).default(['goalArea']),
})
export type InsightsQuery = z.infer<typeof InsightsQuery>

export const InsightsResponse = z.object({
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
