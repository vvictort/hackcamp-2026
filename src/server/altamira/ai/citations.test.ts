import { describe, expect, it } from 'vitest'
import { AltamiraError } from '../contract/errors'
import { KAI, SOFIA, STUDENT_IDS } from '../fixtures'
import {
  IE_STATEMENT,
  IEP_RELATION_STATEMENT,
  applyReportingRules,
  assertCitations,
  checkCitations,
  checkReportingRules,
  type CitableDataPoint,
} from './citations'

const points: CitableDataPoint[] = [
  ...KAI.dataPoints.map((p) => ({ id: p.id, status: p.status, studentId: STUDENT_IDS.kai })),
  ...SOFIA.dataPoints.map((p) => ({ id: p.id, status: p.status, studentId: STUDENT_IDS.sofia })),
]
const confirmed = KAI.dataPoints.find((p) => p.status === 'confirmed')!.id
const auto = KAI.dataPoints.find((p) => p.status === 'auto_confirmed')!.id
const pending = KAI.dataPoints.find((p) => p.status === 'pending_review')!.id
const sofias = SOFIA.dataPoints[0].id

const draft = (...citations: string[][]) => ({ sentences: citations.map((c) => ({ text: 's', citations: c })) })

describe('checkCitations', () => {
  it('accepts confirmed and auto-confirmed points of the same student', () => {
    expect(checkCitations(draft([confirmed, auto], [auto]), points, STUDENT_IDS.kai)).toEqual({ ok: true })
  })
  it('rejects unknown, foreign and unconfirmed citations', () => {
    expect(checkCitations(draft([confirmed], ['nope', sofias, pending]), points, STUDENT_IDS.kai)).toEqual({
      ok: false,
      problems: [
        { sentenceIndex: 1, dataPointId: 'nope', reason: 'not_found' },
        { sentenceIndex: 1, dataPointId: sofias, reason: 'other_student' },
        { sentenceIndex: 1, dataPointId: pending, reason: 'not_confirmed' },
      ],
    })
  })
  it('assertCitations throws bad_request', () => {
    expect(() => assertCitations(draft([pending]), points, STUDENT_IDS.kai)).toThrow(AltamiraError)
    expect(() => assertCitations(draft([confirmed]), points, STUDENT_IDS.kai)).not.toThrow()
  })
})

describe('BC reporting rules', () => {
  const sentences = [{ text: 'Kai used his break card 3 times on most days.', citations: [confirmed] }]

  it('suggests IE when evidence is insufficient, replacing any level', () => {
    const d = { sentences, proficiencySuggestion: 'Developing' as const }
    expect(checkReportingRules(d, { insufficientEvidence: true })).toEqual(['ie_not_suggested', 'missing_iep_relation_statement'])
    const fixed = applyReportingRules(d, { insufficientEvidence: true })
    expect(fixed.proficiencySuggestion).toBe('IE')
    expect(fixed.sentences.map((s) => s.text)).toEqual([sentences[0].text, IE_STATEMENT, IEP_RELATION_STATEMENT])
    expect(checkReportingRules(fixed, { insufficientEvidence: true })).toEqual([])
  })

  it('states that a scale indicator is in relation to IEP goals', () => {
    const d = { sentences, proficiencySuggestion: 'Proficient' as const }
    expect(checkReportingRules(d, { insufficientEvidence: false })).toEqual(['missing_iep_relation_statement'])
    const fixed = applyReportingRules(d, { insufficientEvidence: false })
    expect(fixed.proficiencySuggestion).toBe('Proficient')
    expect(fixed.sentences.at(-1)?.text).toBe(IEP_RELATION_STATEMENT)
    expect(applyReportingRules(fixed, { insufficientEvidence: false }).sentences).toHaveLength(2)
  })

  it('accepts a draft that already says it in its own words', () => {
    const d = { sentences: [...sentences, { text: 'This level is in relation to his IEP goals.', citations: [confirmed] }], proficiencySuggestion: 'Extending' as const }
    expect(checkReportingRules(d, { insufficientEvidence: false })).toEqual([])
  })

  it('never fills in a level when there is none (no default to Emerging or Developing)', () => {
    const fixed = applyReportingRules({ sentences, proficiencySuggestion: null }, { insufficientEvidence: false })
    expect(fixed.proficiencySuggestion).toBeNull()
    expect(fixed.sentences).toEqual(sentences)
  })
})
