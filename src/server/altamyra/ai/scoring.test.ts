import { describe, expect, it } from 'vitest'
import { RUBRIC_AGREEMENT_MIN, routeByConfidence, routeScore, scoreObjectiveItem, scoreObjectiveItems } from './scoring'

describe('scoreObjectiveItem', () => {
  const cases: [string | number | null | undefined, string[], boolean][] = [
    ['12', ['12'], true],
    [12, ['12'], true],
    [' 12.0 ', ['12'], true],
    ['1,000', ['1000'], true],
    ['13', ['12'], false],
    ['  The Main Idea. ', ['the main idea'], true],
    ['Sofía', ['sofía'], true],
    ['B', ['A', 'b'], true],
    ['', ['0'], false],
    [null, ['0'], false],
    [undefined, ['x'], false],
    ['twelve', ['12'], false],
  ]
  it.each(cases)('%j vs %j -> %s', (response, accepted, correct) => {
    expect(scoreObjectiveItem(response, { accepted })).toEqual({ correct, score: correct ? 1 : 0 })
  })

  it('scores a whole check; missing answers are wrong', () => {
    const key = [
      { itemId: 'q1', accepted: ['12'] },
      { itemId: 'q2', accepted: ['15'] },
      { itemId: 'q3', accepted: ['B'] },
    ]
    const r = scoreObjectiveItems({ q1: '12', q2: '14' }, key)
    expect(r).toEqual({
      items: [
        { itemId: 'q1', correct: true },
        { itemId: 'q2', correct: false },
        { itemId: 'q3', correct: false },
      ],
      correct: 1,
      total: 3,
      percent: 100 / 3,
    })
    expect(scoreObjectiveItems({}, []).percent).toBe(0)
  })
})

describe('routeByConfidence', () => {
  it('sends low confidence to review', () => {
    expect(routeScore({ confidence: 0.5, threshold: 0.8, sampleRate: 0, seed: 'a' })).toEqual({ status: 'pending_review', reviewKind: 'low_confidence' })
    expect(routeByConfidence(0.8, 0.8, 0, 'a')).toBe('auto_confirmed')
  })

  it('samples confident scores deterministically at about the sample rate', () => {
    const seeds = Array.from({ length: 2000 }, (_, i) => `dp-${i}`)
    const sampled = seeds.filter((s) => routeByConfidence(0.95, 0.8, 0.2, s) === 'pending_review')
    expect(sampled.length / seeds.length).toBeGreaterThan(0.15)
    expect(sampled.length / seeds.length).toBeLessThan(0.25)
    expect(seeds.filter((s) => routeByConfidence(0.95, 0.8, 0.2, s) === 'pending_review')).toEqual(sampled)
    expect(routeScore({ confidence: 0.95, threshold: 0.8, sampleRate: 1, seed: 'x' }).reviewKind).toBe('sampled')
    expect(seeds.every((s) => routeByConfidence(0.95, 0.8, 0, s) === 'auto_confirmed')).toBe(true)
  })

  it('keeps every rubric score in review until agreement reaches 90%', () => {
    for (const agreement of [undefined, null, 0, 0.5, 0.89]) {
      expect(routeByConfidence(0.99, 0.5, 0, 's', { rubric: true, agreement })).toBe('pending_review')
    }
    expect(routeByConfidence(0.99, 0.5, 0, 's', { rubric: true, agreement: RUBRIC_AGREEMENT_MIN })).toBe('auto_confirmed')
    expect(routeByConfidence(0.4, 0.5, 0, 's', { rubric: true, agreement: 0.95 })).toBe('pending_review')
  })

  it('rejects values outside 0..1', () => {
    expect(() => routeByConfidence(1.2, 0.8, 0, 's')).toThrow(RangeError)
    expect(() => routeByConfidence(0.9, 0.8, -0.1, 's')).toThrow(RangeError)
    expect(() => routeByConfidence(Number.NaN, 0.8, 0, 's')).toThrow(RangeError)
  })
})
