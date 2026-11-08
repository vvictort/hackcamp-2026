import { z } from 'zod'

/**
 * Schemas for the four summary drafts (daily, weekly, monthly family, district
 * monthly). Provider outputs carry no status: createSummaryAi stamps
 * status 'draft' and generatedBy 'ai' on every result.
 *
 * APPROVAL IS ENFORCED IN THE ROUTES, NOT HERE. These functions only draft.
 * Routes must store the result as a draft visible to the EA or teacher alone,
 * and release it to its audience (case manager, parent, district lead) only
 * after an EA or teacher approves it.
 */

const Id = z.string().min(1)
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const Month = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM')
const StudentRef = z.string().min(1)

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length
const maxWords = (n: number) => (s: string) => wordCount(s) <= n

/** Stamped on every summary result so callers cannot release it unapproved. */
export const DRAFT_STAMP = { status: 'draft', generatedBy: 'ai' } as const
export type DraftStamp = typeof DRAFT_STAMP

// ---------- daily ----------

export const SummaryDataPoint = z.object({
  id: Id,
  objective: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  promptLevel: z.string().optional(),
  note: z.string().optional(),
  /** Unconfirmed points (unreviewed AI scores) are dropped before anything is sent. */
  confirmed: z.boolean(),
})
export type SummaryDataPoint = z.infer<typeof SummaryDataPoint>

export const SummaryEvent = z.object({ id: Id, kind: z.string().min(1), text: z.string().optional(), at: z.string().optional() })
export const SummaryNote = z.object({ id: Id, text: z.string().min(1) })

export const DraftDailyInput = z.object({
  studentToken: StudentRef,
  date: IsoDate,
  dataPoints: z.array(SummaryDataPoint),
  events: z.array(SummaryEvent).default([]),
  notes: z.array(SummaryNote).default([]),
})
export type DraftDailyInput = z.input<typeof DraftDailyInput>

export const DraftDailyModelOutput = z.object({
  text: z.string().min(1).refine(maxWords(120), 'at most 120 words'),
  highlights: z.array(z.string().min(1)).max(5),
  citations: z.array(Id),
})
export const DraftDailyOutput = DraftDailyModelOutput.extend({ status: z.literal('draft'), generatedBy: z.literal('ai') })
export type DraftDailyOutput = z.infer<typeof DraftDailyOutput>

// ---------- weekly ----------

export const FLAGS = ['on_track', 'watch', 'needs_attention'] as const
export const WeeklyStudent = z.object({
  studentRef: StudentRef,
  objectives: z.array(
    z.object({
      objective: z.string().min(1),
      /** One entry per day with a confirmed value. */
      trend: z.array(z.object({ id: Id, date: IsoDate, value: z.number(), confirmed: z.boolean() })),
    }),
  ),
  notableEvents: z.array(SummaryEvent).default([]),
})
export const DraftWeeklyInput = z.object({ weekStart: IsoDate, students: z.array(WeeklyStudent).min(1) })
export type DraftWeeklyInput = z.input<typeof DraftWeeklyInput>

export const DraftWeeklyModelOutput = z.object({
  overview: z.string().min(1).refine(maxWords(150), 'at most 150 words'),
  perStudent: z.array(z.object({ studentRef: StudentRef, text: z.string().min(1).refine(maxWords(60), 'at most 60 words'), flag: z.enum(FLAGS) })),
  citations: z.array(Id),
})
export const DraftWeeklyOutput = DraftWeeklyModelOutput.extend({ status: z.literal('draft'), generatedBy: z.literal('ai') })
export type DraftWeeklyOutput = z.infer<typeof DraftWeeklyOutput>

// ---------- monthly family ----------

export const DraftMonthlyFamilyInput = z.object({
  month: Month,
  studentToken: StudentRef,
  objectives: z.array(
    z.object({
      objective: z.string().min(1),
      /** Confirmed monthly points, oldest first. */
      points: z.array(z.object({ id: Id, date: IsoDate, value: z.number(), confirmed: z.boolean() })),
    }),
  ),
  highlights: z.array(z.string().min(1)).default([]),
  /** BCP 47 tag of the family's language. */
  language: z.string().min(2).default('en'),
})
export type DraftMonthlyFamilyInput = z.input<typeof DraftMonthlyFamilyInput>

export const DraftMonthlyFamilyModelOutput = z.object({
  text: z.string().min(1).refine(maxWords(200), 'at most 200 words'),
  citations: z.array(Id),
})
export const DraftMonthlyFamilyOutput = DraftMonthlyFamilyModelOutput.extend({
  /** Language of `text`. 'en' when the requested language was not available. */
  language: z.string().min(2),
  /** The English draft the translation came from (same as text when language is 'en'). */
  englishText: z.string().min(1),
  status: z.literal('draft'),
  generatedBy: z.literal('ai'),
})
export type DraftMonthlyFamilyOutput = z.infer<typeof DraftMonthlyFamilyOutput>

export const TranslateSummaryInput = z.object({ text: z.string().min(1), language: z.string().min(2), studentToken: StudentRef.optional() })
export type TranslateSummaryInput = z.input<typeof TranslateSummaryInput>
export const TranslateSummaryModelOutput = z.object({ language: z.string().min(2), text: z.string().min(1) })
export const TranslateSummaryOutput = TranslateSummaryModelOutput.extend({ status: z.literal('draft'), generatedBy: z.literal('ai') })
export type TranslateSummaryOutput = z.infer<typeof TranslateSummaryOutput>

// ---------- district monthly ----------

/** Aggregates only. .strict() rejects studentId, name or any other per-student key. */
export const DistrictAggregateRow = z
  .object({
    metric: z.string().min(1),
    group: z.string().min(1),
    /** Students in the group. Rows under MIN_DISTRICT_GROUP are dropped. */
    n: z.number().int().nonnegative(),
    value: z.number(),
    unit: z.string().optional(),
  })
  .strict()
export type DistrictAggregateRow = z.infer<typeof DistrictAggregateRow>
export const MIN_DISTRICT_GROUP = 10

export const DraftDistrictInput = z.object({ month: Month, aggregates: z.array(DistrictAggregateRow) }).strict()
export type DraftDistrictInput = z.input<typeof DraftDistrictInput>

export const DraftDistrictModelOutput = z.object({ text: z.string().min(1).refine(maxWords(250), 'at most 250 words') })
export const DraftDistrictOutput = DraftDistrictModelOutput.extend({ status: z.literal('draft'), generatedBy: z.literal('ai') })
export type DraftDistrictOutput = z.infer<typeof DraftDistrictOutput>
