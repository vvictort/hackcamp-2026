/** Photo pages: deterministic fallback (demo and AI failure). */

export type PageItemScore = { itemId: string; value: number; confidence: number }

/** Confidence given to the item a fallback or demo sheet sends to review (below AI_CONFIDENCE_THRESHOLD 0.8). */
export const FALLBACK_LOW_CONFIDENCE = 0.62
const FALLBACK_CONFIDENT = 0.93

/**
 * Scores a photographed page without a model: used when the AI call fails or
 * no key is set. Deterministic for a given check. Keyed items alternate
 * correct, correct, wrong; rubric items take the middle level. The last item
 * is always low confidence, so the page goes to review rather than being
 * trusted (PRD 1B: low confidence goes to review).
 */
export function fallbackPageScore(items: readonly { id: string }[], rubricTop: number | null): PageItemScore[] {
  return items.map((item, i) => ({
    itemId: item.id,
    value: rubricTop === null ? (i % 3 === 2 ? 0 : 1) : Math.round(rubricTop / 2),
    confidence: i === items.length - 1 ? FALLBACK_LOW_CONFIDENCE : FALLBACK_CONFIDENT,
  }))
}

/** Demo sheets always show the review flow: when no item is below the threshold, the last one is lowered. */
export function ensureReviewable(items: readonly PageItemScore[], threshold: number): PageItemScore[] {
  if (items.length === 0 || items.some((i) => i.confidence < threshold)) return [...items]
  return items.map((it, i) => (i === items.length - 1 ? { ...it, confidence: Math.min(it.confidence, FALLBACK_LOW_CONFIDENCE) } : it))
}
