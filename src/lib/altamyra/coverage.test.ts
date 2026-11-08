import { describe, expect, it } from 'vitest'
import { coverageOf, tallyCoverage } from './coverage'

const base = { objectiveId: 'o', current: 3, recentCount: 3, latestDecision: null } as const

describe('coverageOf', () => {
  it('classifies goals', () => {
    expect(coverageOf(base)).toBe('fresh')
    expect(coverageOf({ ...base, recentCount: 1 })).toBe('stale')
    expect(coverageOf({ ...base, recentCount: 0 })).toBe('data_needed')
    expect(coverageOf({ ...base, objectiveId: null })).toBe('data_needed')
    expect(coverageOf({ ...base, latestDecision: 'data_needed' })).toBe('data_needed')
  })
  it('tallies', () => {
    expect(tallyCoverage(['fresh', 'fresh', 'stale'])).toEqual({ fresh: 2, stale: 1, data_needed: 0 })
  })
})
