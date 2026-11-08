import { afterEach, describe, expect, it } from 'vitest'
import { userActor } from '../contract/permissions'
import { DISTRICT, SCHOOL, demoPeerIncrements } from '../fixtures'
import { applyCounterIncrements } from '../rooms/insights-core'
import type { InsightGroup } from './insights'
import { parseSourceRef } from './sources'
import { ACTORS, closeAll, insightsRoom, runInsights } from './testing'

afterEach(closeAll)

const inc = (studentKey: string, goalArea: string) => ({ schoolId: SCHOOL.id, period: '2026-27 T1', studentKey, goalArea, proficiencyLevel: null, label: null, reviewTimeliness: null })
const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `hash-${prefix}-${i}`)

describe('District Insights (PRD: no group under 10 is ever displayed)', () => {
  it('suppresses groups with fewer than 10 students, and the smallest sibling so it cannot be subtracted out', () => {
    const sql = insightsRoom()
    const push = (increments: unknown[]) => applyCounterIncrements(sql, DISTRICT.id, increments)
    push([...keys('r', 9).map((k) => inc(k, 'Reading')), ...keys('w', 10).map((k) => inc(k, 'Writing')), ...keys('m', 12).map((k) => inc(k, 'Math'))])
    // Repeat pushes raise counts, never the student count.
    push(keys('r', 9).map((k) => inc(k, 'Reading')))
    const { groups } = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id }, ACTORS.districtLead)
    expect(groups).toEqual([
      { dims: { goalArea: 'Math' }, students: 12, count: 12, suppressed: false },
      { dims: { goalArea: 'Reading' }, students: null, count: null, suppressed: true },
      { dims: { goalArea: 'Writing' }, students: null, count: null, suppressed: true },
    ])
  })

  it('a finer grouping cannot be differenced against a coarser one (complementary suppression)', () => {
    const sql = insightsRoom()
    // 12 Writing students: 11 with adaptations, 1 with a modification.
    applyCounterIncrements(sql, DISTRICT.id, keys('w', 12).map((k, i) => ({ ...inc(k, 'Writing'), label: i === 0 ? 'modification' : 'adaptation' })))
    const coarse = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id, groupBy: ['goalArea'] }, ACTORS.districtLead)
    expect(coarse.groups[0]).toMatchObject({ students: 12, suppressed: false })
    const fine = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id, groupBy: ['goalArea', 'label'] }, ACTORS.districtLead)
    // 12 - 11 would reveal the 1; both cells are hidden.
    expect(fine.groups.every((g) => g.suppressed)).toBe(true)
  })

  it('groups by goal progress and review timeliness', () => {
    const sql = insightsRoom()
    applyCounterIncrements(sql, DISTRICT.id, keys('g', 10).map((k) => ({ ...inc(k, 'Math'), goalProgress: 'near_goal_line' })))
    applyCounterIncrements(sql, DISTRICT.id, keys('g', 10).map((k) => ({ ...inc(k, 'Math'), goalArea: null, reviewTimeliness: 'on_time' })))
    const progress = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id, groupBy: ['goalProgress'] }, ACTORS.districtLead)
    expect(progress.groups.find((g) => g.dims.goalProgress === 'near_goal_line')).toMatchObject({ students: 10, suppressed: false })
    const timely = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id, groupBy: ['reviewTimeliness'] }, ACTORS.districtLead)
    expect(timely.groups.find((g) => g.dims.reviewTimeliness === 'on_time')).toMatchObject({ students: 10, suppressed: false })
  })

  it('suppresses at every grouping, including combined dimensions', () => {
    const sql = insightsRoom()
    applyCounterIncrements(sql, DISTRICT.id, keys('w', 12).map((k, i) => ({ ...inc(k, 'Writing'), label: i < 3 ? 'modification' : 'adaptation' })))
    const { groups } = runInsights<{ groups: InsightGroup[] }>(sql, 'insights.get', { districtId: DISTRICT.id, groupBy: ['goalArea', 'label'] }, ACTORS.districtLead)
    expect(groups.find((g) => g.dims.label === 'modification')).toMatchObject({ suppressed: true, students: null })
    expect(groups.find((g) => g.dims.label === 'adaptation')).toMatchObject({ suppressed: true, students: null })
    expect(groups.every((g) => g.suppressed || (g.students ?? 0) >= 10)).toBe(true)
  })

  it('accepts only hashed student keys and only district leads of that district read', () => {
    const sql = insightsRoom()
    expect(() => applyCounterIncrements(sql, DISTRICT.id, [inc('57d00000-0000-4000-8000-00000000000a', 'Reading')])).toThrow(/hash/)
    expect(() => runInsights(sql, 'insights.get', { districtId: DISTRICT.id }, ACTORS.caseManager)).toThrow(/insights.view/)
    expect(() => runInsights(sql, 'insights.get', { districtId: 'other' }, userActor('x', { districtLeadOf: [DISTRICT.id] }))).toThrow(/not_in_scope/)
  })
})

describe('parseSourceRef', () => {
  it('opens every source kind', () => {
    expect(parseSourceRef('photo:uploads/a.jpg#q2')).toEqual({ kind: 'photo', fileKey: 'uploads/a.jpg', itemId: 'q2' })
    // student_response refs belong to the removed student mode; an old row falls back to a plain note.
    expect(parseSourceRef('student_response:s1:check-1/q1')).toEqual({ kind: 'teacher', note: 'student_response:s1:check-1/q1' })
    expect(parseSourceRef('ea_event:counter:abc')).toEqual({ kind: 'ea_event', eventKind: 'counter' })
    expect(parseSourceRef('usage:sg1')).toEqual({ kind: 'usage', suggestionId: 'sg1' })
    expect(parseSourceRef('teacher:quick rating')).toEqual({ kind: 'teacher', note: 'quick rating' })
    expect(parseSourceRef(null)).toEqual({ kind: 'teacher', note: null })
  })
})

describe('district monthly narrative (template text, not AI)', () => {
  const narrative = (sql: ReturnType<typeof insightsRoom>, period?: string) =>
    runInsights<{ monthlyNarrative: { period: string | null; text: string } }>(sql, 'insights.get', { districtId: DISTRICT.id, period }, ACTORS.districtLead).monthlyNarrative
  const inMonth = (studentKey: string, goalArea: string, period = '2026-11') => ({ ...inc(studentKey, goalArea), period })

  it('says nothing is recorded yet on an empty district', () => {
    expect(narrative(insightsRoom())).toEqual({ period: null, text: 'No learning data has been recorded for the district yet.' })
  })

  it('reports shown groups only and never mentions a suppressed group or its size', () => {
    const sql = insightsRoom()
    applyCounterIncrements(sql, DISTRICT.id, [...keys('r', 12).map((k) => inMonth(k, 'Reading')), ...keys('w', 3).map((k) => inMonth(k, 'Writing')), ...keys('m', 15).map((k) => inMonth(k, 'Math')), ...keys('s', 20).map((k) => inMonth(k, 'Science'))])
    const n = narrative(sql)
    expect(n.period).toBe('2026-11')
    expect(n.text).toContain('Math: 15 students')
    expect(n.text).toContain('Science: 20 students')
    // Writing is under 10 students; Reading (its smallest sibling) is hidden too, so Writing cannot be subtracted out.
    expect(n.text).not.toMatch(/Writing|Reading/)
    expect(n.text).not.toMatch(/hash-|student key|studentKey|[0-9a-f]{8}-[0-9a-f]{4}/i)
    // Only one group of three: nothing to report, and the small group is not named.
    const small = insightsRoom()
    applyCounterIncrements(small, DISTRICT.id, keys('w', 3).map((k) => inMonth(k, 'Writing')))
    expect(narrative(small).text).toMatch(/nothing to report/)
    expect(narrative(small).text).not.toMatch(/Writing|3/)
  })

  it('follows the requested period', () => {
    const sql = insightsRoom()
    applyCounterIncrements(sql, DISTRICT.id, [...keys('a', 10).map((k) => inMonth(k, 'Reading', '2026-10')), ...keys('b', 10).map((k) => inMonth(k, 'Math', '2026-11'))])
    expect(narrative(sql, '2026-10').text).toContain('Reading')
    expect(narrative(sql, '2026-10').text).not.toContain('Math')
    expect(narrative(sql).period).toBe('2026-11')
  })
})

describe('district monthly narrative with demo peers', () => {
  it('reads sensibly from aggregates and hides the small demo groups', () => {
    const sql = insightsRoom()
    applyCounterIncrements(sql, DISTRICT.id, demoPeerIncrements('2026-11'))
    const n = runInsights<{ monthlyNarrative: { period: string | null; text: string } }>(sql, 'insights.get', { districtId: DISTRICT.id }, ACTORS.districtLead).monthlyNarrative
    expect(n.period).toBe('2026-11')
    expect(n.text).toContain('Reading: 14 students')
    expect(n.text).toContain('Math: 12 students')
    expect(n.text).not.toMatch(/Writing|Science|demopeer/)
  })
})
