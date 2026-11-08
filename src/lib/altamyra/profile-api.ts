import type { z } from 'zod'
import type {
  CaptureEventBody,
  GoalStatusResponse,
  IepImportResponse,
  ProficiencyResponse,
  ProficiencySetBody,
} from '@/server/altamyra/contract/api'
import type { Objective } from '@/server/altamyra/contract/student'
import type { Proficiency } from '@/server/altamyra/contract/enums'
import { apiFetch, enc } from './api'

type R<T extends z.ZodType> = z.infer<T>

/** Above the server's 35 s model-chain budget, plus storing. */
const IMPORT_TIMEOUT_MS = 60_000

/** IEP import with a 60 s client timeout so a stuck model call shows an error. */
export const importIepTimed = (id: string, text: string) =>
  apiFetch<IepImportResponse>(`/students/${enc(id)}/iep/import`, { body: { sourceKind: 'text', text }, timeoutMs: IMPORT_TIMEOUT_MS })

// ---------- quick rating ----------

export type QuickRating = 'not_yet' | 'emerging' | 'got_it'
export const QUICK_RATINGS: readonly QuickRating[] = ['not_yet', 'emerging', 'got_it']

const PROMPT_FOR: Record<QuickRating, 'model' | 'verbal' | 'independent'> = { not_yet: 'model', emerging: 'verbal', got_it: 'independent' }
const SHARE_OF_TARGET: Record<QuickRating, number> = { not_yet: 0.25, emerging: 0.6, got_it: 1 }

/**
 * The event a one-tap rating records for this objective, or null when the
 * measure cannot be rated by a tap (durations, latencies: use the timer).
 * Prompt-level measures use prompt levels; accuracy, rate and rubric record a
 * whole-number share of the target; frequency records one occurrence.
 */
export function ratingEvent(objective: Pick<Objective, 'id' | 'metricType' | 'target'>, rating: QuickRating): CaptureEventBody | null {
  const base = { objectiveId: objective.id, classId: null, lessonId: null }
  switch (objective.metricType) {
    case 'prompt_level':
      return { ...base, kind: 'prompt_level', promptLevel: PROMPT_FOR[rating] }
    case 'accuracy':
    case 'rate':
    case 'rubric':
      return { ...base, kind: 'counter', count: Math.round(objective.target * SHARE_OF_TARGET[rating]) }
    case 'frequency':
      return rating === 'not_yet' ? null : { ...base, kind: 'counter', count: 1 }
    default:
      return null
  }
}

// ---------- proficiency ----------

export const PROFICIENCY_CHOICES: readonly Proficiency[] = ['Emerging', 'Developing', 'Proficient', 'Extending']

export interface ProficiencySuggestion {
  level: Proficiency
  /** i18n keys of the reasons, with their values. */
  reasons: { key: 'few' | 'progress' | 'target' | 'below' | 'above' | 'trend'; vars: Record<string, string | number> }[]
}

/** Suggests a BC proficiency level from the goal's confirmed data. The person always makes the call. */
export function suggestProficiency(st: Pick<GoalStatusResponse, 'baseline' | 'current' | 'target' | 'trend' | 'recentCount' | 'latestDecision'>): ProficiencySuggestion {
  const reasons: ProficiencySuggestion['reasons'] = []
  if (st.current === null || st.target === null || st.recentCount < 3) {
    reasons.push({ key: 'few', vars: { n: st.recentCount } })
    return { level: 'IE', reasons }
  }
  const from = st.baseline ?? 0
  const span = st.target - from
  const share = span === 0 ? (st.current === st.target ? 1 : 0) : (st.current - from) / span
  reasons.push({ key: 'progress', vars: { pct: Math.round(Math.max(0, share) * 100) } })
  if (st.latestDecision === 'below_aimline') reasons.push({ key: 'below', vars: {} })
  if (st.latestDecision === 'above_aimline') reasons.push({ key: 'above', vars: {} })
  if (st.trend !== null) reasons.push({ key: 'trend', vars: { dir: st.trend > 0 ? 'up' : st.trend < 0 ? 'down' : 'flat' } })
  let level: Proficiency = share >= 1.15 ? 'Extending' : share >= 0.85 ? 'Proficient' : share >= 0.4 ? 'Developing' : 'Emerging'
  if (st.latestDecision === 'below_aimline' && level === 'Proficient') level = 'Developing'
  if (level === 'Proficient' || level === 'Extending') reasons.push({ key: 'target', vars: { current: st.current, target: st.target } })
  return { level, reasons }
}

export const defaultPeriod = (now = new Date()) => now.toISOString().slice(0, 7)

export const saveProficiency = (studentId: string, goalId: string, body: Pick<ProficiencySetBody, 'level' | 'period'> & { narrative?: string | null }) =>
  apiFetch<R<typeof ProficiencyResponse>>(`/goals/${enc(goalId)}/proficiency`, { body: { narrative: null, ...body }, query: { studentId } })
