import { describe, expect, it } from 'vitest'
import { students } from '@/i18n/en/students'
import { ADAPTATION_TYPES, DATA_POINT_SOURCES, METRIC_TYPES, PROPOSAL_TARGETS } from '@/server/altamira/contract/enums'
import { s } from './text'

describe('students strings', () => {
  it('covers every enum value used in dynamic keys', () => {
    const keys = new Set(Object.keys(students))
    for (const m of METRIC_TYPES) expect(keys.has(`students.metric.${m}`)).toBe(true)
    for (const a of ADAPTATION_TYPES) expect(keys.has(`students.adaptation.${a}`)).toBe(true)
    for (const d of DATA_POINT_SOURCES) expect(keys.has(`students.source.${d}`)).toBe(true)
    for (const t of PROPOSAL_TARGETS) expect(keys.has(`students.propose.target.${t}`)).toBe(true)
  })
  it('interpolates variables', () => {
    expect(s('students.grade', { grade: '4' })).toBe('Grade 4')
  })
})
