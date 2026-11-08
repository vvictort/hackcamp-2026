import { describe, expect, it } from 'vitest'
import { ensureReviewable, fallbackPageScore, FALLBACK_LOW_CONFIDENCE } from './scoring'

const items = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }]

describe('fallbackPageScore', () => {
  it('is deterministic and has a low-confidence last item', () => {
    const a = fallbackPageScore(items, null)
    expect(a).toEqual(fallbackPageScore(items, null))
    expect(a.map((i) => i.value)).toEqual([1, 1, 0])
    expect(a.at(-1)?.confidence).toBe(FALLBACK_LOW_CONFIDENCE)
    expect(a[0].confidence).toBeGreaterThanOrEqual(0.8)
  })
  it('uses the middle rubric level for rubric checks', () => {
    expect(fallbackPageScore(items, 4).map((i) => i.value)).toEqual([2, 2, 2])
  })
})

describe('ensureReviewable', () => {
  it('lowers the last item when all are confident', () => {
    const out = ensureReviewable([{ itemId: 'a', value: 1, confidence: 0.95 }, { itemId: 'b', value: 1, confidence: 0.9 }], 0.8)
    expect(out.map((i) => i.confidence)).toEqual([0.95, FALLBACK_LOW_CONFIDENCE])
  })
  it('leaves already-low pages alone', () => {
    const src = [{ itemId: 'a', value: 1, confidence: 0.5 }]
    expect(ensureReviewable(src, 0.8)).toEqual(src)
  })
})
