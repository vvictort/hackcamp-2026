import { describe, expect, it } from 'vitest'
import { AI_CONFIDENCE_THRESHOLD, AI_REVIEW_SAMPLE_RATE, routing } from './capture'

describe('routing', () => {
  it('sends low confidence to review', () => {
    expect(routing(AI_CONFIDENCE_THRESHOLD - 0.01, 'a')).toEqual({ status: 'pending_review', reviewKind: 'low_confidence' })
    expect(routing(AI_CONFIDENCE_THRESHOLD - 0.01, 'a', true).reviewKind).toBe('low_confidence')
  })

  it('samples confident scores deterministically at about the sample rate', () => {
    const seeds = Array.from({ length: 2000 }, (_, i) => `dp-${i}`)
    const sampled = seeds.filter((s) => routing(0.95, s).status === 'pending_review')
    expect(sampled.length / seeds.length).toBeGreaterThan(AI_REVIEW_SAMPLE_RATE - 0.05)
    expect(sampled.length / seeds.length).toBeLessThan(AI_REVIEW_SAMPLE_RATE + 0.05)
    expect(seeds.filter((s) => routing(0.95, s).status === 'pending_review')).toEqual(sampled)
    expect(sampled.every((s) => routing(0.95, s).reviewKind === 'sampled')).toBe(true)
    expect(routing(AI_CONFIDENCE_THRESHOLD, seeds.find((s) => !sampled.includes(s))!)).toEqual({ status: 'auto_confirmed', reviewKind: null })
  })

  it('keeps every confident rubric score in review', () => {
    expect(routing(0.99, 's', true)).toEqual({ status: 'pending_review', reviewKind: 'sampled' })
  })
})
