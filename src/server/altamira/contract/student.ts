import { z } from 'zod'
import { DateString, Id, RowVersion, Timestamp } from './common'
import {
  AdaptationType,
  CheckStatus,
  ConsentKind,
  DataPointSource,
  DataPointStatus,
  DecisionRule,
  DraftStatus,
  FamilySummaryStatus,
  GapType,
  GoalStatus,
  Label,
  MetricType,
  ObjectiveStatus,
  Proficiency,
  ProposalStatus,
  ProposalTarget,
  ReviewKind,
  ReviewStatus,
  SuggestionStatus,
} from './enums'

/**
 * Entities stored in AltamiraStudentRoom (one room per student).
 * Field names are camelCase; the DDL uses the snake_case form, and a field
 * holding an object or array is stored in a column named <field>_json.
 * Nullable columns are `.nullable()`, never optional, so a row maps 1:1.
 */

// ---------- CB-IEP sections (iep_versions.sections_json) ----------

export const IepGoalSection = z.object({
  area: z.string().min(1),
  text: z.string().min(1),
})

export const IepSections = z.object({
  /** Identifying fields. Never sent to a model; the AI module replaces them with tokens. */
  student: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    preferredName: z.string().nullable(),
    grade: z.string().min(1),
  }),
  profile: z.object({
    designation: z.string().nullable(),
    strengths: z.array(z.string()),
    interests: z.array(z.string()),
    stretches: z.array(z.string()),
  }),
  coreCompetencies: z.object({
    communication: z.string(),
    thinking: z.string(),
    personalSocial: z.string(),
  }),
  goals: z.array(IepGoalSection),
  accommodations: z.array(z.string()),
  supports: z.array(z.string()),
  /** Subjects with a modified program, with the IEP's wording. Mirrored in modificationSubjects. */
  modifications: z.array(z.object({ subject: z.string().min(1), description: z.string() })),
  reviewDate: DateString.nullable(),
})
export type IepSections = z.infer<typeof IepSections>

// ---------- tables ----------

export const IepVersion = z.object({
  id: Id,
  /** IEP version number, 1, 2, 3 ... A change is a new row, never an edit of a confirmed one. */
  version: z.number().int().min(1),
  sections: IepSections,
  /** Subject keys where the IEP authorizes modification (PRD 1A-5), e.g. ["math"]. */
  modificationSubjects: z.array(z.string()),
  sourceFileKey: z.string().nullable(),
  importedBy: Id,
  importedAt: Timestamp,
  confirmedBy: Id.nullable(),
  confirmedAt: Timestamp.nullable(),
  /** Optimistic lock for the confirm step (column "version" holds the IEP number). */
  rowVersion: RowVersion,
})
export type IepVersion = z.infer<typeof IepVersion>

export const Goal = z.object({
  id: Id,
  iepVersion: z.number().int().min(1),
  area: z.string().min(1),
  text: z.string().min(1),
  status: GoalStatus,
  version: RowVersion,
})
export type Goal = z.infer<typeof Goal>

export const Objective = z.object({
  id: Id,
  goalId: Id,
  metricType: MetricType,
  unit: z.string(),
  baseline: z.number().nullable(),
  /** How the baseline is gathered when no value exists yet (from proposeObjectives). */
  baselineMethod: z.string().nullable(),
  target: z.number(),
  masteryRule: z.string(),
  reviewDate: DateString.nullable(),
  captureMethod: DataPointSource,
  status: ObjectiveStatus,
  flagReason: z.string().nullable(),
  confirmedBy: Id.nullable(),
  confirmedAt: Timestamp.nullable(),
  version: RowVersion,
})
export type Objective = z.infer<typeof Objective>

export const LensRun = z.object({
  id: Id,
  lessonId: Id,
  analysisId: Id,
  createdBy: Id,
  createdAt: Timestamp,
})
export type LensRun = z.infer<typeof LensRun>

/** suggestions.content_json for kind "gap" (PRD 1A-3: names the goal or accommodation). */
export const GapContent = z.object({
  title: z.string().min(1),
  why: z.string(),
  accommodation: z.string().nullable(),
})
export type GapContent = z.infer<typeof GapContent>

/** suggestions.content_json for kind "adaptation". */
export const AdaptationContent = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  why: z.string(),
  /** Subject key of the lesson, used by the modification guardrail. */
  subject: z.string().min(1),
  /** Whether the change alters the learning outcome. Input to classifyAdaptation(), PRD 1A-5. */
  changesOutcome: z.boolean(),
})
export type AdaptationContent = z.infer<typeof AdaptationContent>

const SuggestionBase = z.object({
  id: Id,
  lensRunId: Id,
  goalIds: z.array(Id),
  status: SuggestionStatus,
  createdAt: Timestamp,
  version: RowVersion,
})

export const GapSuggestion = SuggestionBase.extend({
  kind: z.literal('gap'),
  gapType: GapType,
  adaptationType: z.null(),
  label: z.null(),
  content: GapContent,
})

export const AdaptationSuggestion = SuggestionBase.extend({
  kind: z.literal('adaptation'),
  gapType: z.null(),
  adaptationType: AdaptationType,
  label: Label,
  // PRD 1A-4: each adaptation is tagged to at least one IEP goal.
  goalIds: z.array(Id).min(1),
  content: AdaptationContent,
})

export const Suggestion = z.discriminatedUnion('kind', [GapSuggestion, AdaptationSuggestion])
export type Suggestion = z.infer<typeof Suggestion>
export type GapSuggestion = z.infer<typeof GapSuggestion>
export type AdaptationSuggestion = z.infer<typeof AdaptationSuggestion>

export const CheckItem = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  format: z.enum(['multiple_choice', 'short_answer', 'numeric', 'work_sample']),
  options: z.array(z.string()).nullable(),
})
export type CheckItem = z.infer<typeof CheckItem>

export const AnswerKeyEntry = z.object({
  itemId: z.string().min(1),
  /** Accepted answers; deterministic scoring compares normalised text or numbers. */
  accepted: z.array(z.string()).min(1),
})
export type AnswerKeyEntry = z.infer<typeof AnswerKeyEntry>

export const Rubric = z.object({
  criteria: z.array(z.object({ id: z.string().min(1), description: z.string() })).min(1),
  levels: z.array(z.object({ score: z.number(), description: z.string() })).min(2),
})
export type Rubric = z.infer<typeof Rubric>

export const Check = z.object({
  id: Id,
  suggestionId: Id,
  objectiveId: Id,
  items: z.array(CheckItem).min(1).max(3),
  answerKey: z.array(AnswerKeyEntry).nullable(),
  rubric: Rubric.nullable(),
  status: CheckStatus,
  version: RowVersion,
})
export type Check = z.infer<typeof Check>

export const ProbeForm = z.object({
  items: z.array(CheckItem).min(1),
  answerKey: z.array(AnswerKeyEntry),
  /** Timed probes (rate metrics) run for this many seconds; null when untimed. */
  timeLimitSeconds: z.number().int().positive().nullable(),
})

export const Probe = z.object({
  id: Id,
  objectiveId: Id,
  skill: z.string().min(1),
  level: z.string().min(1),
  form: ProbeForm,
})
export type Probe = z.infer<typeof Probe>

export const DataPoint = z.object({
  id: Id,
  objectiveId: Id,
  value: z.number(),
  unit: z.string(),
  source: DataPointSource,
  recorderId: Id,
  recordedAt: Timestamp,
  classId: Id.nullable(),
  lessonId: Id.nullable(),
  activeAdaptations: z.array(Id),
  aiConfidence: z.number().min(0).max(1).nullable(),
  status: DataPointStatus,
  /** Link to the source: photo file + item, student-mode response, EA event or suggestion id. */
  sourceRef: z.string().nullable(),
  version: RowVersion,
  /** A correction is a new row pointing at the row it replaces. */
  supersedesId: Id.nullable(),
  reason: z.string().nullable(),
})
export type DataPoint = z.infer<typeof DataPoint>

export const ReviewItem = z.object({
  id: Id,
  dataPointId: Id,
  kind: ReviewKind,
  status: ReviewStatus,
  createdAt: Timestamp,
  resolvedBy: Id.nullable(),
  resolvedAt: Timestamp.nullable(),
  version: RowVersion,
})
export type ReviewItem = z.infer<typeof ReviewItem>

export const Decision = z.object({
  id: Id,
  objectiveId: Id,
  rule: DecisionRule,
  firedAt: Timestamp,
  response: z.string().nullable(),
  respondedBy: Id.nullable(),
  version: RowVersion,
})
export type Decision = z.infer<typeof Decision>

export const UsageEvent = z.object({
  id: Id,
  suggestionId: Id,
  approvedBy: Id,
  at: Timestamp,
})
export type UsageEvent = z.infer<typeof UsageEvent>

export const Proposal = z.object({
  id: Id,
  target: ProposalTarget,
  /** Free-form description of the proposed change, e.g. { goalId, newText }. */
  change: z.record(z.string(), z.unknown()),
  evidenceIds: z.array(Id),
  proposedBy: Id,
  createdAt: Timestamp,
  status: ProposalStatus,
  resolvedBy: Id.nullable(),
  resolvedAt: Timestamp.nullable(),
  resolutionNote: z.string().nullable(),
  version: RowVersion,
})
export type Proposal = z.infer<typeof Proposal>

export const ParentInput = z.object({
  id: Id,
  authorId: Id,
  text: z.string().min(1),
  language: z.string().min(2),
  createdAt: Timestamp,
  version: RowVersion,
})
export type ParentInput = z.infer<typeof ParentInput>

export const Consent = z.object({
  id: Id,
  kind: ConsentKind,
  /** The parent or guardian who gave consent. */
  grantedBy: Id,
  /** Who entered it: the parent, or a case manager recording it. */
  recordedBy: Id,
  grantedAt: Timestamp,
  revokedAt: Timestamp.nullable(),
  version: RowVersion,
})
export type Consent = z.infer<typeof Consent>

export const ProficiencyRating = z.object({
  id: Id,
  goalId: Id,
  level: Proficiency,
  period: z.string().min(1),
  narrative: z.string().nullable(),
  setBy: Id,
  setAt: Timestamp,
})
export type ProficiencyRating = z.infer<typeof ProficiencyRating>

export const DraftSentence = z.object({
  text: z.string().min(1),
  citations: z.array(Id),
})
export type DraftSentence = z.infer<typeof DraftSentence>

export const ProgressDraft = z.object({
  id: Id,
  goalId: Id,
  period: z.string().min(1),
  dueDate: DateString.nullable(),
  sentences: z.array(DraftSentence),
  proficiencySuggestion: Proficiency.nullable(),
  status: DraftStatus,
  createdBy: Id,
  createdAt: Timestamp,
  updatedBy: Id.nullable(),
  updatedAt: Timestamp.nullable(),
  usedAt: Timestamp.nullable(),
  version: RowVersion,
})
export type ProgressDraft = z.infer<typeof ProgressDraft>

export const DraftCitation = z.object({
  id: Id,
  draftId: Id,
  sentenceIndex: z.number().int().min(0),
  dataPointId: Id,
})
export type DraftCitation = z.infer<typeof DraftCitation>

export const HandoffPacket = z.object({
  goals: z.array(
    z.object({
      goalId: Id,
      area: z.string(),
      text: z.string(),
      trend: z.string().nullable(),
      proficiency: Proficiency.nullable(),
    }),
  ),
  whatWorks: z.array(z.object({ adaptationType: AdaptationType, n: z.number().int(), meanOutcome: z.number().nullable() })),
  suggestedNextGoals: z.array(z.string()),
})
export type HandoffPacket = z.infer<typeof HandoffPacket>

export const Handoff = z.object({
  id: Id,
  createdBy: Id,
  createdAt: Timestamp,
  toSchool: z.string().nullable(),
  packet: HandoffPacket,
})
export type Handoff = z.infer<typeof Handoff>

export const FamilySummary = z.object({
  id: Id,
  draftId: Id,
  language: z.string().min(2),
  text: z.string().min(1),
  status: FamilySummaryStatus,
  createdAt: Timestamp,
  approvedBy: Id.nullable(),
  approvedAt: Timestamp.nullable(),
  version: RowVersion,
})
export type FamilySummary = z.infer<typeof FamilySummary>

export const AuditEntry = z.object({
  id: Id,
  at: Timestamp,
  actorId: z.string().min(1),
  action: z.string().min(1),
  tableName: z.string().min(1),
  rowId: z.string().min(1),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
})
export type AuditEntry = z.infer<typeof AuditEntry>

/** Table names in the student room, for audit_log.table_name. */
export const STUDENT_TABLES = [
  'iep_versions',
  'goals',
  'objectives',
  'lens_runs',
  'suggestions',
  'checks',
  'probes',
  'data_points',
  'review_queue',
  'decisions',
  'usage_events',
  'proposals',
  'parent_inputs',
  'consents',
  'proficiency_ratings',
  'progress_drafts',
  'draft_citations',
  'handoffs',
  'family_summaries',
  'audit_log',
] as const
export type StudentTable = (typeof STUDENT_TABLES)[number]
