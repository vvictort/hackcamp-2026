import { describe, expect, it } from 'vitest'
import { RUBRIC_AGREEMENT_MIN, routeScore } from './scoring'

const status = (confidence: number, threshold: number, sampleRate: number, seed: string, opts: { rubric?: boolean; agreement?: number | null } = {}) =>
  routeScore({ confidence, threshold, sampleRate, seed, ...opts }).status

describe('routeScore', () => {
  it('sends low confidence to review', () => {
    expect(routeScore({ confidence: 0.5, threshold: 0.8, sampleRate: 0, seed: 'a' })).toEqual({ status: 'pending_review', reviewKind: 'low_confidence' })
    expect(status(0.8, 0.8, 0, 'a')).toBe('auto_confirmed')
  })

  it('samples confident scores deterministically at about the sample rate', () => {
    const seeds = Array.from({ length: 2000 }, (_, i) => `dp-${i}`)
    const sampled = seeds.filter((s) => status(0.95, 0.8, 0.2, s) === 'pending_review')
    expect(sampled.length / seeds.length).toBeGreaterThan(0.15)
    expect(sampled.length / seeds.length).toBeLessThan(0.25)
    expect(seeds.filter((s) => status(0.95, 0.8, 0.2, s) === 'pending_review')).toEqual(sampled)
    expect(routeScore({ confidence: 0.95, threshold: 0.8, sampleRate: 1, seed: 'x' }).reviewKind).toBe('sampled')
    expect(seeds.every((s) => status(0.95, 0.8, 0, s) === 'auto_confirmed')).toBe(true)
  })

  it('keeps every rubric score in review until agreement reaches 90%', () => {
    for (const agreement of [undefined, null, 0, 0.5, 0.89]) {
      expect(status(0.99, 0.5, 0, 's', { rubric: true, agreement })).toBe('pending_review')
    }
    expect(status(0.99, 0.5, 0, 's', { rubric: true, agreement: RUBRIC_AGREEMENT_MIN })).toBe('auto_confirmed')
    expect(status(0.4, 0.5, 0, 's', { rubric: true, agreement: 0.95 })).toBe('pending_review')
  })

  it('rejects values outside 0..1', () => {
    expect(() => status(1.2, 0.8, 0, 's')).toThrow(RangeError)
    expect(() => status(0.9, 0.8, -0.1, 's')).toThrow(RangeError)
    expect(() => status(Number.NaN, 0.8, 0, 's')).toThrow(RangeError)
  })
})
