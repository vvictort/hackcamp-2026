import { describe, expect, it } from 'vitest'
import { sheetSpeech } from './LensSheet'
import type { StudentAnalysis } from '@/lib/lessonLens'

describe('sheetSpeech', () => {
  it('reads adaptations and checks, not rejected ones', () => {
    const st = {
      suggestions: [{ text: 'Use steps', state: 'approved' }, { text: 'Skip me', state: 'rejected' }],
      checks: [{ code: 'G1-C1', text: 'Can the student retell?' }],
    } as unknown as StudentAnalysis
    expect(sheetSpeech(st)).toBe('Use steps. Can the student retell?')
  })
})
