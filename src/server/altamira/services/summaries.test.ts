import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AltamiraError } from '../contract/errors'
import type { Summary } from '../contract/student'
import { STUDENT_IDS } from '../fixtures'
import { isoWeekOf, periodDates, resolvePeriod, weekStartOf, type SummaryInputs } from './summaries'
import { ACTORS, closeAll, runStudent, studentRoom } from './testing'

// Pin Date so seeded data, periods and any default 'now' share one instant (not the wall clock).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-09T17:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
  closeAll()
})

const kai = STUDENT_IDS.kai
const NOW = '2026-11-09T17:00:00.000Z'

describe('periods', () => {
  it('maps dates to ISO weeks and back', () => {
    expect(isoWeekOf('2026-11-09')).toBe('2026-W46')
    expect(isoWeekOf('2026-01-01')).toBe('2026-W01')
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53')
    expect(weekStartOf('2026-W46')).toBe('2026-11-09')
    expect(periodDates('weekly', '2026-W46')).toEqual({ first: '2026-11-09', last: '2026-11-15' })
    expect(periodDates('monthly', '2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' })
  })

  it('defaults to the current period and rejects a malformed one', () => {
    expect(resolvePeriod('daily', undefined, NOW)).toBe('2026-11-09')
    expect(resolvePeriod('weekly', undefined, NOW)).toBe('2026-W46')
    expect(resolvePeriod('monthly', undefined, NOW)).toBe('2026-11')
    expect(() => resolvePeriod('monthly', '2026-13', NOW)).toThrow(AltamiraError)
    expect(() => resolvePeriod('weekly', '2026-W54', NOW)).toThrow(AltamiraError)
    expect(() => resolvePeriod('daily', '2026-11', NOW)).toThrow(AltamiraError)
  })
})

describe('summary inputs hold confirmed data only', () => {
  it('drops pending-review points from the daily, weekly and monthly inputs', () => {
    const sql = studentRoom('kai')
    const objectiveId = (runStudent<{ objectives: { objectiveId: string }[] }>(sql, 'objectives.forCapture', { studentId: kai }, ACTORS.ea).objectives[0]).objectiveId
    const add = (value: number, status: 'confirmed' | 'pending_review') =>
      runStudent(
        sql,
        'dataPoints.addPending',
        { studentId: kai, objectiveId, value, aiConfidence: 0.5, routing: status === 'confirmed' ? { status: 'auto_confirmed' } : { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: `photo:f${value}#q1`, now: NOW },
        ACTORS.ea,
      )
    add(41, 'confirmed')
    add(77, 'pending_review')
    for (const [kind, period] of [['daily', '2026-11-09'], ['weekly', '2026-W46'], ['monthly', '2026-11']] as const) {
      const inputs = runStudent<SummaryInputs>(sql, 'summaries.inputs', { studentId: kai, kind, period, now: NOW }, ACTORS.ea)
      const json = JSON.stringify(inputs)
      expect(json, kind).toContain('41')
      expect(json, kind).not.toContain('77')
    }
    expect(() => runStudent(sql, 'summaries.inputs', { studentId: kai, kind: 'daily', now: NOW }, ACTORS.caseManager)).toThrow(AltamiraError)
  })
})

describe('summary rows', () => {
  const save = (sql: ReturnType<typeof studentRoom>, kind = 'weekly', actor = ACTORS.ea) =>
    runStudent<{ summary: Summary }>(sql, 'familySummaries.save', { studentId: kai, kind, period: kind === 'weekly' ? '2026-W46' : '2026-10', text: 'A fictional summary.', now: NOW }, actor).summary
  const list = (sql: ReturnType<typeof studentRoom>, actor: typeof ACTORS.parentKai) => runStudent<{ summaries: Summary[] }>(sql, 'familySummaries.list', { studentId: kai }, actor).summaries

  it('only the EA and teacher save, edit, approve and see drafts', () => {
    const sql = studentRoom('kai')
    const s = save(sql)
    expect(s).toMatchObject({ status: 'draft', approvedBy: null, audioScript: null })
    for (const actor of [ACTORS.caseManager, ACTORS.parentKai, ACTORS.districtLead]) {
      expect(() => save(sql, 'weekly', actor)).toThrow(AltamiraError)
      expect(() => runStudent(sql, 'summaries.edit', { studentId: kai, summaryId: s.id, text: 'x', version: 1 }, actor)).toThrow(AltamiraError)
      expect(() => runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: s.id, version: 1 }, actor)).toThrow(AltamiraError)
    }
    expect(list(sql, ACTORS.teacher)).toHaveLength(1)
    expect(list(sql, ACTORS.caseManager)).toEqual([])
    runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: s.id, version: 1 }, ACTORS.teacher)
    expect(list(sql, ACTORS.caseManager)).toHaveLength(1)
    expect(list(sql, ACTORS.parentKai)).toEqual([])
  })

  it('a monthly summary builds its audio script from the translation and returns to draft on edit', () => {
    const sql = studentRoom('kai')
    const s = save(sql, 'monthly')
    const edited = runStudent<{ summary: Summary }>(sql, 'summaries.edit', { studentId: kai, summaryId: s.id, text: 'English.', translatedText: 'Espanol.', language: 'es', version: 1, now: NOW }, ACTORS.ea).summary
    expect(edited).toMatchObject({ translatedText: 'Espanol.', language: 'es', audioScript: 'Espanol.', status: 'draft', editedBy: ACTORS.ea.userId })
    runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: s.id, version: edited.version }, ACTORS.ea)
    expect(list(sql, ACTORS.parentKai)).toHaveLength(1)
    expect(list(sql, ACTORS.caseManager)).toEqual([])
    const again = runStudent<{ summary: Summary }>(sql, 'summaries.edit', { studentId: kai, summaryId: s.id, text: 'English 2.', version: edited.version + 1 }, ACTORS.teacher).summary
    expect(again).toMatchObject({ status: 'draft', approvedBy: null, translatedText: 'Espanol.' })
    expect(list(sql, ACTORS.parentKai)).toEqual([])
    expect(() => runStudent(sql, 'summaries.edit', { studentId: kai, summaryId: s.id, text: 'x', translatedText: 'y', version: 1 }, ACTORS.ea)).toThrow(/version/)
  })

  it('a parent of another child cannot list, and a weekly summary has no translation', () => {
    const sql = studentRoom('kai')
    const s = save(sql)
    expect(() => list(sql, ACTORS.parentAmara)).toThrow(/not_in_scope/)
    expect(() => runStudent(sql, 'summaries.edit', { studentId: kai, summaryId: s.id, text: 'x', translatedText: 'y', version: 1 }, ACTORS.ea)).toThrow(/translation/)
  })

  it('every write is audited', () => {
    const sql = studentRoom('kai')
    const s = save(sql)
    runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: s.id, version: 1 }, ACTORS.ea)
    expect(sql.all<{ action: string }>("SELECT action FROM audit_log WHERE table_name = 'summaries' ORDER BY rowid").map((a) => a.action)).toEqual(['summaries.create', 'summaries.approve'])
  })
})
