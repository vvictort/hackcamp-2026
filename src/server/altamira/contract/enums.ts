import { z } from 'zod'

/**
 * Every closed vocabulary used by Altamira. The DDL builds its CHECK
 * constraints from these same arrays, so the database and the API agree.
 */

/** PRD 1B "Metric type" table, in rollout order. */
export const METRIC_TYPES = ['accuracy', 'prompt_level', 'frequency', 'rate', 'duration', 'latency', 'rubric'] as const
export const MetricType = z.enum(METRIC_TYPES)
export type MetricType = z.infer<typeof MetricType>

/** PRD 1B independence scale, most support first. */
export const PROMPT_LEVELS = ['full_physical', 'partial_physical', 'model', 'gesture', 'verbal', 'independent'] as const
export const PromptLevel = z.enum(PROMPT_LEVELS)
export type PromptLevel = z.infer<typeof PromptLevel>

/**
 * A prompt-level data point stores its level as a number so analytics can
 * treat it like any other metric: 0 = full_physical ... 5 = independent.
 */
export const promptLevelValue = (level: PromptLevel): number => PROMPT_LEVELS.indexOf(level)
export const promptLevelFromValue = (value: number): PromptLevel | undefined => PROMPT_LEVELS[value]

export const DATA_POINT_SOURCES = ['auto', 'photo', 'probe', 'student', 'ea', 'teacher'] as const
export const DataPointSource = z.enum(DATA_POINT_SOURCES)
export type DataPointSource = z.infer<typeof DataPointSource>

export const DATA_POINT_STATUSES = ['confirmed', 'auto_confirmed', 'pending_review'] as const
export const DataPointStatus = z.enum(DATA_POINT_STATUSES)
export type DataPointStatus = z.infer<typeof DataPointStatus>

/** Statuses a parent or a family summary may see (PRD "Parents see only confirmed data"). */
export const FAMILY_VISIBLE_STATUSES = ['confirmed', 'auto_confirmed'] as const satisfies readonly DataPointStatus[]

/** PRD 1A-3 gap types. */
export const GAP_TYPES = ['access', 'goal', 'accommodation', 'engagement'] as const
export const GapType = z.enum(GAP_TYPES)
export type GapType = z.infer<typeof GapType>

/** PRD 1A-4 adaptation kinds. */
export const ADAPTATION_TYPES = [
  'simplified_text',
  'chunked_steps',
  'sentence_frames',
  'visual_supports',
  'alternative_demonstration',
  'modified_assessment',
] as const
export const AdaptationType = z.enum(ADAPTATION_TYPES)
export type AdaptationType = z.infer<typeof AdaptationType>

/** PRD 1A-5 label, decided in code. */
export const LABELS = ['adaptation', 'modification'] as const
export const Label = z.enum(LABELS)
export type Label = z.infer<typeof Label>

/** K-9 Provincial Proficiency Scale plus IE (insufficient evidence). */
export const PROFICIENCY_LEVELS = ['Emerging', 'Developing', 'Proficient', 'Extending', 'IE'] as const
export const Proficiency = z.enum(PROFICIENCY_LEVELS)
export type Proficiency = z.infer<typeof Proficiency>

export const GOAL_STATUSES = ['active', 'closed'] as const
export const GoalStatus = z.enum(GOAL_STATUSES)

export const OBJECTIVE_STATUSES = ['proposed', 'confirmed', 'flagged_unmeasurable'] as const
export const ObjectiveStatus = z.enum(OBJECTIVE_STATUSES)
export type ObjectiveStatus = z.infer<typeof ObjectiveStatus>

export const SUGGESTION_KINDS = ['gap', 'adaptation'] as const
export const SuggestionKind = z.enum(SUGGESTION_KINDS)

export const SUGGESTION_STATUSES = ['draft', 'approved', 'edited', 'rejected', 'blocked'] as const
export const SuggestionStatus = z.enum(SUGGESTION_STATUSES)
export type SuggestionStatus = z.infer<typeof SuggestionStatus>

export const CHECK_STATUSES = ['active', 'removed'] as const
export const CheckStatus = z.enum(CHECK_STATUSES)

export const REVIEW_KINDS = ['low_confidence', 'sampled'] as const
export const ReviewKind = z.enum(REVIEW_KINDS)

export const REVIEW_STATUSES = ['open', 'resolved'] as const
export const ReviewStatus = z.enum(REVIEW_STATUSES)

export const DECISION_RULES = ['below_aimline', 'above_aimline', 'data_needed'] as const
export const DecisionRule = z.enum(DECISION_RULES)
export type DecisionRule = z.infer<typeof DecisionRule>

export const PROPOSAL_TARGETS = ['iep', 'profile', 'objective'] as const
export const ProposalTarget = z.enum(PROPOSAL_TARGETS)

export const PROPOSAL_STATUSES = ['open', 'accepted', 'declined'] as const
export const ProposalStatus = z.enum(PROPOSAL_STATUSES)

export const CONSENT_KINDS = ['student_mode', 'audio'] as const
export const ConsentKind = z.enum(CONSENT_KINDS)
export type ConsentKind = z.infer<typeof ConsentKind>

export const DRAFT_STATUSES = ['draft', 'edited', 'used'] as const
export const DraftStatus = z.enum(DRAFT_STATUSES)

export const FAMILY_SUMMARY_STATUSES = ['draft', 'approved'] as const
export const FamilySummaryStatus = z.enum(FAMILY_SUMMARY_STATUSES)

/** Roles held in the school room's memberships table. Parents are linked through parent_links. */
export const MEMBERSHIP_ROLES = ['case_manager', 'teacher', 'ea', 'school_admin', 'district_lead'] as const
export const MembershipRole = z.enum(MEMBERSHIP_ROLES)
export type MembershipRole = z.infer<typeof MembershipRole>

/** PRD 1A-1 accepted lesson formats. PPTX arrives already converted to PDF. */
export const LESSON_SOURCE_KINDS = ['pdf', 'docx', 'image', 'text'] as const
export const LessonSourceKind = z.enum(LESSON_SOURCE_KINDS)

export const SHARE_TOKEN_KINDS = ['today_view', 'student_session'] as const
export const ShareTokenKind = z.enum(SHARE_TOKEN_KINDS)
export type ShareTokenKind = z.infer<typeof ShareTokenKind>

export const CAPTURE_BATCH_STATUSES = ['processing', 'done', 'failed'] as const
export const CaptureBatchStatus = z.enum(CAPTURE_BATCH_STATUSES)

export const REVIEW_TIMELINESS = ['on_time', 'late'] as const
export const ReviewTimeliness = z.enum(REVIEW_TIMELINESS)
export type ReviewTimeliness = z.infer<typeof ReviewTimeliness>

/** District Insights goal progress: where a goal's confirmed data sits against its goal line (PRD 1B decision rules). */
export const GOAL_PROGRESS = ['above_goal_line', 'near_goal_line', 'below_goal_line', 'insufficient_data'] as const
export const GoalProgress = z.enum(GOAL_PROGRESS)
export type GoalProgress = z.infer<typeof GoalProgress>

/** EA-assisted capture event kinds (PRD 1B: prompt level, counters, timers). */
export const EVENT_KINDS = ['prompt_level', 'counter', 'timer'] as const
export const EventKind = z.enum(EVENT_KINDS)
export type EventKind = z.infer<typeof EventKind>
