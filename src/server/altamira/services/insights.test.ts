import { afterEach, describe, expect, it } from 'vitest'
import { userActor } from '../contract/permissions'
import { DISTRICT, SCHOOL } from '../fixtures'
import type { InsightGroup } from './insights'
import { parseSourceRef } from './sources'
import { ACTORS, closeAll, insightsRoom, runInsights } from './testing'

afterEach(closeAll)

const inc = (studentKey: string, goalArea: string) => ({ schoolId: SCHOOL.id, period: '2026-27 T1', studentKey, goalArea, proficiencyLevel: null, label: null, reviewTimeliness: null })
const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `hash-${prefix}-${i}`)

describe('District Insights (PRD: no group under 10 is ever displayed)', () => {
  it('suppresses groups with fewer than 10 students', () => {
    const sql = insightsRoom()
    runInsights(sql, 'counters.push', { districtId: DISTRICT.id, increments: [...keys('r', 9).map((k) => inc(k, 'Reading')), ...keys('w', 10).map((k) => inc(k, 'Writing'))] }, ACTORS.system)
    // Repeat pushes raise counts, never the student count.
    runInsights(sql, 'counters.push', { districtId: DISTRICT.id, increments: keys('r', 9).map((k) => inc(k, 'Reading')) }, ACTORS.system)
    const { groups } = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id }, ACTORS.districtLead)
    expect(groups).toEqual([
      { dims: { goalArea: 'Reading' }, students: null, count: null, suppressed: true },
      { dims: { goalArea: 'Writing' }, students: 10, count: 10, suppressed: false },
    ])
  })

  it('suppresses at every grouping, including combined dimensions', () => {
    const sql = insightsRoom()
    runInsights(sql, 'counters.push', { districtId: DISTRICT.id, increments: keys('w', 12).map((k, i) => ({ ...inc(k, 'Writing'), label: i < 3 ? 'modification' : 'adaptation' })) }, ACTORS.system)
    const { groups } = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id, groupBy: ['goalArea', 'label'] }, ACTORS.districtLead)
    expect(groups.find((g) => g.dims.label === 'modification')).toMatchObject({ suppressed: true, students: null })
    expect(groups.find((g) => g.dims.label === 'adaptation')).toMatchObject({ suppressed: true, students: null })
    expect(groups.every((g) => g.suppressed || (g.students ?? 0) >= 10)).toBe(true)
  })

  it('accepts only hashed student keys and only district leads of that district read', () => {
    const sql = insightsRoom()
    expect(() => runInsights(sql, 'counters.push', { districtId: DISTRICT.id, increments: [inc('57d00000-0000-4000-8000-00000000000a', 'Reading')] }, ACTORS.system)).toThrow(/hash/)
    expect(() => runInsights(sql, 'insights.get', { districtId: DISTRICT.id }, ACTORS.caseManager)).toThrow(/insights.view/)
    expect(() => runInsights(sql, 'insights.get', { districtId: 'other' }, userActor('x', { districtLeadOf: [DISTRICT.id] }))).toThrow(/not_in_scope/)
  })
})

describe('parseSourceRef', () => {
  it('opens every source kind', () => {
    expect(parseSourceRef('photo:uploads/a.jpg#q2')).toEqual({ kind: 'photo', fileKey: 'uploads/a.jpg', itemId: 'q2' })
    expect(parseSourceRef('student_response:s1:check-1/q1')).toEqual({ kind: 'student_response', sessionId: 's1', itemId: 'check-1/q1' })
    expect(parseSourceRef('ea_event:counter:abc')).toEqual({ kind: 'ea_event', eventKind: 'counter' })
    expect(parseSourceRef('usage:sg1')).toEqual({ kind: 'usage', suggestionId: 'sg1' })
    expect(parseSourceRef('teacher:quick rating')).toEqual({ kind: 'teacher', note: 'quick rating' })
    expect(parseSourceRef(null)).toEqual({ kind: 'teacher', note: null })
  })
})
