import { describe, expect, it } from 'vitest'
import { CaptureEventBody } from '@/server/altamira/contract/api'
import { eventKindsFor, formatClock } from './EaPanel'

describe('EA goal controls', () => {
  it('shows only the controls the server accepts for each metric', () => {
    expect(eventKindsFor('prompt_level')).toEqual(['prompt_level'])
    expect(eventKindsFor('frequency')).toEqual(['counter'])
    expect(eventKindsFor('duration')).toEqual(['timer'])
    expect(eventKindsFor('other')).toEqual([])
  })
  it('accepts a tally of 0 as data', () => {
    expect(CaptureEventBody.safeParse({ kind: 'counter', objectiveId: 'o1', count: 0 }).success).toBe(true)
    expect(CaptureEventBody.safeParse({ kind: 'counter', objectiveId: 'o1', count: -1 }).success).toBe(false)
  })
  it('formats the clock', () => expect(formatClock(75)).toBe('1:15'))
})
