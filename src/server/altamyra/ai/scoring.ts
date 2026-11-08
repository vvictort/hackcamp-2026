import type { REVIEW_KINDS } from '../contract/enums'
import type { AnswerKeyEntry } from '../contract/student'
import { unitInterval } from './hash'

/**
 * Deterministic scoring and confidence routing (design doc "Deterministic
 * scoring" and "Confidence"). Student-mode objective items are scored
 * against the key in code, never by the model.
 */

export type ItemResponse = string | number | null | undefined

/** PRD 1B: rubric scores auto-confirm only after AI-teacher agreement reaches 90%. */
export const RUBRIC_AGREEMENT_MIN = 0.9

const NUMBER_RE = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

function normalise(value: ItemResponse): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^["'`([{]+|["'`)\]}.!?,;:]+$/g, '')
    .trim()
}

const asNumber = (s: string): number | null => (NUMBER_RE.test(s) ? Number(s.replace(/,/g, '')) : null)

function matches(response: string, accepted: string): boolean {
  const a = normalise(accepted)
  if (response === '' || a === '') return false
  const rn = asNumber(response)
  const an = asNumber(a)
  if (rn !== null && an !== null) return rn === an
  return response === a
}

export function scoreObjectiveItem(response: ItemResponse, key: Pick<AnswerKeyEntry, 'accepted'>): { correct: boolean; score: 0 | 1 } {
  const r = normalise(response)
  const correct = key.accepted.some((a) => matches(r, a))
  return { correct, score: correct ? 1 : 0 }
}

/** Scores every keyed item; percent is the share correct, for "% correct" objectives. A missing response is wrong. */
export function scoreObjectiveItems(
  responses: Record<string, ItemResponse>,
  answerKey: AnswerKeyEntry[],
): { items: { itemId: string; correct: boolean }[]; correct: number; total: number; percent: number } {
  const items = answerKey.map((k) => ({ itemId: k.itemId, correct: scoreObjectiveItem(responses[k.itemId], k).correct }))
  const correct = items.filter((i) => i.correct).length
  const total = items.length
  return { items, correct, total, percent: total === 0 ? 0 : (correct * 100) / total }
}

export type RouteStatus = 'auto_confirmed' | 'pending_review'
type ReviewKind = (typeof REVIEW_KINDS)[number]

export type RouteInput = {
  /** AI confidence, 0 to 1. */
  confidence: number
  /** Below this the score goes to review. */
  threshold: number
  /** Share of confident scores also sent to review, 0 to 1. */
  sampleRate: number
  /** Stable per score (e.g. the data point id), so the sampling decision is reproducible. */
  seed: string
  rubric?: boolean
  /** Measured AI-teacher agreement on sampled rubric scores, 0 to 1. */
  agreement?: number | null
}

export type RouteResult = { status: RouteStatus; reviewKind: ReviewKind | null }

const assertUnit = (name: string, v: number) => {
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`${name} must be between 0 and 1`)
}

export function routeScore(input: RouteInput): RouteResult {
  assertUnit('confidence', input.confidence)
  assertUnit('threshold', input.threshold)
  assertUnit('sampleRate', input.sampleRate)
  if (input.confidence < input.threshold) return { status: 'pending_review', reviewKind: 'low_confidence' }
  // PRD 1B: every rubric score goes to review until agreement reaches 90%.
  if (input.rubric && !((input.agreement ?? 0) >= RUBRIC_AGREEMENT_MIN)) return { status: 'pending_review', reviewKind: 'sampled' }
  if (unitInterval(input.seed, 'sample') < input.sampleRate) return { status: 'pending_review', reviewKind: 'sampled' }
  return { status: 'auto_confirmed', reviewKind: null }
}

export function routeByConfidence(
  score: number,
  threshold: number,
  sampleRate: number,
  seed: string,
  opts: { rubric?: boolean; agreement?: number | null } = {},
): RouteStatus {
  return routeScore({ confidence: score, threshold, sampleRate, seed, ...opts }).status
}
