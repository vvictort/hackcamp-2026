import { z } from 'zod'
import { Id, MediaRef } from './common'
import { AdaptationType, DataPointSource, EventKind, GapType, Label, MetricType, PromptLevel } from './enums'
import { LessonAnalysisBody } from './school'
import { AnswerKeyEntry, CheckItem, Rubric } from './student'

/**
 * Inputs and outputs of every AI function (design doc "AI module").
 * Every input is de-identified before it reaches a provider: students appear
 * only as studentToken (SchoolStudent.displayToken), never by name, and no
 * staff or family names are included. Outputs are parsed with these schemas;
 * anything that does not parse is rejected.
 */

const StudentToken = z.string().min(1)

// ---------- proposeObjectives ----------

export const ProposeObjectivesInput = z.object({
  studentToken: StudentToken,
  goalId: Id,
  area: z.string().min(1),
  goalText: z.string().min(1),
})
export type ProposeObjectivesInput = z.infer<typeof ProposeObjectivesInput>

export const ProposeObjectivesOutput = z.discriminatedUnion('measurable', [
  z.object({
    measurable: z.literal(true),
    goalId: Id,
    metricType: MetricType,
    unit: z.string(),
    baselineMethod: z.string().min(1),
    target: z.number(),
    masteryRule: z.string().min(1),
    captureMethod: DataPointSource,
  }),
  z.object({
    measurable: z.literal(false),
    goalId: Id,
    reason: z.string().min(1),
  }),
])
export type ProposeObjectivesOutput = z.infer<typeof ProposeObjectivesOutput>

// ---------- analyseLesson (PRD 1A-2: once per lesson, cached) ----------

export const AnalyseLessonInput = z.object({
  lessonId: Id,
  title: z.string(),
  subject: z.string().min(1),
  grade: z.string().min(1),
  text: z.string().nullable(),
  /** Set when the lesson is a file the model reads directly (PDF or image). */
  file: MediaRef.nullable(),
})
export type AnalyseLessonInput = z.infer<typeof AnalyseLessonInput>

export const AnalyseLessonOutput = LessonAnalysisBody
export type AnalyseLessonOutput = z.infer<typeof AnalyseLessonOutput>

// ---------- lensForStudent (PRD 1A-3, 1A-4, 1A-6, 1A-9) ----------

export const DeidentifiedProfile = z.object({
  studentToken: StudentToken,
  grade: z.string().min(1),
  strengths: z.array(z.string()),
  interests: z.array(z.string()),
  goals: z.array(
    z.object({
      goalId: Id,
      area: z.string(),
      text: z.string(),
      objective: z
        .object({ objectiveId: Id, metricType: MetricType, unit: z.string(), target: z.number() })
        .nullable(),
    }),
  ),
  accommodations: z.array(z.string()),
  supports: z.array(z.string()),
  modificationSubjects: z.array(z.string()),
})
export type DeidentifiedProfile = z.infer<typeof DeidentifiedProfile>

export const WhatWorksRow = z.object({
  adaptationType: AdaptationType,
  n: z.number().int().min(0),
  meanOutcome: z.number().nullable(),
})
export type WhatWorksRow = z.infer<typeof WhatWorksRow>

export const LensForStudentInput = z.object({
  lessonId: Id,
  subject: z.string().min(1),
  analysis: LessonAnalysisBody,
  lessonText: z.string().nullable(),
  profile: DeidentifiedProfile,
  /** Only rows that meet the minimum sample rule (PRD 1A-9). */
  whatWorks: z.array(WhatWorksRow),
})
export type LensForStudentInput = z.infer<typeof LensForStudentInput>

export const LensGap = z
  .object({
    gapType: GapType,
    title: z.string().min(1),
    why: z.string(),
    goalIds: z.array(Id),
    accommodation: z.string().nullable(),
  })
  // PRD 1A-3: each gap names the IEP goal or accommodation it comes from.
  .refine((g) => g.goalIds.length > 0 || (g.accommodation ?? '').trim().length > 0, 'a gap names an IEP goal or accommodation')
export type LensGap = z.infer<typeof LensGap>

export const LensAdaptation = z.object({
  adaptationType: AdaptationType,
  title: z.string().min(1),
  text: z.string().min(1),
  why: z.string(),
  goalIds: z.array(Id).min(1),
  changesOutcome: z.boolean(),
  /** The model's own label. Recorded for evals only; never trusted (PRD 1A-5). */
  modelLabel: Label,
})
export type LensAdaptation = z.infer<typeof LensAdaptation>

export const LensCheck = z
  .object({
    goalId: Id,
    objectiveId: Id,
    items: z.array(CheckItem).min(1).max(3),
    answerKey: z.array(AnswerKeyEntry).nullable(),
    rubric: Rubric.nullable(),
  })
  .refine((c) => c.answerKey !== null || c.rubric !== null, 'a check needs an answer key or a rubric')
export type LensCheck = z.infer<typeof LensCheck>

export const LensForStudentOutput = z.object({
  gaps: z.array(LensGap),
  adaptations: z.array(LensAdaptation),
  /** PRD 1A-6: 1 to 3 embedded checks. Empty only when the student has no confirmed objective. */
  checks: z.array(LensCheck).max(3),
})
export type LensForStudentOutput = z.infer<typeof LensForStudentOutput>

// ---------- scorePhotoPage ----------

export const ScorePhotoPageInput = z.object({
  image: MediaRef,
  check: z.object({
    checkId: Id,
    items: z.array(CheckItem).min(1),
    answerKey: z.array(AnswerKeyEntry).nullable(),
    rubric: Rubric.nullable(),
  }),
})
export type ScorePhotoPageInput = z.infer<typeof ScorePhotoPageInput>

export const ScorePhotoPageOutput = z.object({
  /** The sheet code read from the page, or null if unreadable. */
  sheetCode: z.string().nullable(),
  items: z.array(
    z.object({
      itemId: z.string().min(1),
      value: z.number(),
      confidence: z.number().min(0).max(1),
    }),
  ),
})
export type ScorePhotoPageOutput = z.infer<typeof ScorePhotoPageOutput>

// ---------- parseVoiceNote ----------

export const ParseVoiceNoteInput = z.object({
  audio: MediaRef,
  studentToken: StudentToken,
  /** Objectives active in the scheduled class; the goal comes from the schedule. */
  objectives: z.array(z.object({ objectiveId: Id, metricType: MetricType, description: z.string() })),
})
export type ParseVoiceNoteInput = z.infer<typeof ParseVoiceNoteInput>

export const VoiceEvent = z.object({
  objectiveId: Id.nullable(),
  kind: EventKind,
  promptLevel: PromptLevel.nullable(),
  count: z.number().int().min(0).nullable(),
  durationSeconds: z.number().min(0).nullable(),
  confidence: z.number().min(0).max(1),
})
export type VoiceEvent = z.infer<typeof VoiceEvent>

export const ParseVoiceNoteOutput = z.object({ events: z.array(VoiceEvent) })
export type ParseVoiceNoteOutput = z.infer<typeof ParseVoiceNoteOutput>

// ---------- provider ----------

export interface AiProvider {
  proposeObjectives(input: ProposeObjectivesInput): Promise<ProposeObjectivesOutput>
  analyseLesson(input: AnalyseLessonInput): Promise<AnalyseLessonOutput>
  lensForStudent(input: LensForStudentInput): Promise<LensForStudentOutput>
  scorePhotoPage(input: ScorePhotoPageInput): Promise<ScorePhotoPageOutput>
  parseVoiceNote(input: ParseVoiceNoteInput): Promise<ParseVoiceNoteOutput>
}

/** Schema pair per function, so providers and tests can validate generically. */
export const AI_SCHEMAS = {
  proposeObjectives: { input: ProposeObjectivesInput, output: ProposeObjectivesOutput },
  analyseLesson: { input: AnalyseLessonInput, output: AnalyseLessonOutput },
  lensForStudent: { input: LensForStudentInput, output: LensForStudentOutput },
  scorePhotoPage: { input: ScorePhotoPageInput, output: ScorePhotoPageOutput },
  parseVoiceNote: { input: ParseVoiceNoteInput, output: ParseVoiceNoteOutput },
} as const satisfies Record<keyof AiProvider, { input: z.ZodType; output: z.ZodType }>

export type AiFunctionName = keyof typeof AI_SCHEMAS
