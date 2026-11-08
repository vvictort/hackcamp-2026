import { z } from 'zod'
import { Id, RowVersion } from './common'
import { GoalProgress, Label, Proficiency, ReviewTimeliness } from './enums'

/**
 * AltamyraInsightsRoom (one per district): de-identified counters only.
 * studentKey is a one-way hash of the student's opaque id, kept only so reads
 * can count distinct students and suppress small groups.
 */

/** PRD District Insights: groups under 10 students are never displayed. */
export const MIN_GROUP_SIZE = 10

export const Counter = z.object({
  id: Id,
  districtId: Id,
  schoolId: Id,
  period: z.string().min(1),
  studentKey: z.string().min(1),
  goalArea: z.string().nullable(),
  proficiencyLevel: Proficiency.nullable(),
  label: Label.nullable(),
  reviewTimeliness: ReviewTimeliness.nullable(),
  goalProgress: GoalProgress.nullable(),
  count: z.number().int().min(0),
  version: RowVersion,
})
export type Counter = z.infer<typeof Counter>

/** What a student room pushes after a confirmed data point or IEP review (no names, no ids beyond the hash). */
export const CounterIncrement = Counter.pick({
  schoolId: true,
  period: true,
  studentKey: true,
  goalArea: true,
  proficiencyLevel: true,
  label: true,
  reviewTimeliness: true,
}).extend({ goalProgress: GoalProgress.nullable().default(null), by: z.number().int().min(1).default(1) })
export type CounterIncrement = z.infer<typeof CounterIncrement>

export const INSIGHT_DIMENSIONS = ['schoolId', 'goalArea', 'proficiencyLevel', 'label', 'reviewTimeliness', 'goalProgress', 'period'] as const
export const InsightDimension = z.enum(INSIGHT_DIMENSIONS)
export type InsightDimension = z.infer<typeof InsightDimension>
