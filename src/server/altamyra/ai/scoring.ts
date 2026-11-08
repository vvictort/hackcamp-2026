import type { REVIEW_KINDS } from '../contract/enums'
import { unitInterval } from './hash'

/** Confidence routing (design doc "Confidence"). */

/** PRD 1B: rubric scores auto-confirm only after AI-teacher agreement reaches 90%. */
export const RUBRIC_AGREEMENT_MIN = 0.9

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
