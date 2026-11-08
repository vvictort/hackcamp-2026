import { afterEach, describe, expect, it } from 'vitest'
import type { LensStudentResult, SuggestionResponse } from '../contract/api'
import type { LensAdaptation, LensCheck } from '../contract/ai'
import { AltamiraError } from '../contract/errors'
import type { SqlExecutor } from '../db/sql'
import { KAI, SOFIA, STUDENT_IDS } from '../fixtures'
import { ACTORS, closeAll, countRows, runStudent, studentRoom } from './testing'

afterEach(closeAll)

const LESSON = '1e550000-0000-4000-8000-000000000001'
const ANALYSIS = 'a0000000-0000-4000-8000-000000000001'

type Labelled = LensAdaptation & { label: 'adaptation' | 'modification' }

const adaptation = (goalId: string, over: Partial<Labelled> = {}): Labelled => ({
  adaptationType: 'chunked_steps',
  title: 'Chunked steps',
  text: 'Do the task in three short steps.',
  why: 'Instructions one step at a time',
  goalIds: [goalId],
  changesOutcome: false,
  modelLabel: 'adaptation',
  label: 'adaptation',
  ...over,
})

const check = (goalId: string, objectiveId: string): LensCheck => ({
  goalId,
  objectiveId,
  items: [{ id: 'q1', prompt: 'What is 7 + 5?', format: 'numeric', options: null }],
  answerKey: [{ itemId: 'q1', accepted: ['12'] }],
  rubric: null,
})

function saveRun(sql: SqlExecutor, studentId: string, subject: string, adaptations: ReturnType<typeof adaptation>[], checks: LensCheck[] = []) {
  return runStudent<LensStudentResult>(
    sql,
    'lens.saveRun',
    {
      studentId,
      lessonId: LESSON,
      analysisId: ANALYSIS,
      subject,
      gaps: [{ gapType: 'access', title: 'Text above reading level', why: 'Read-aloud support', goalIds: [], accommodation: 'Read-aloud' }],
      adaptations,
      checks,
    },
    ACTORS.teacher,
  )
}

const kaiGoal = KAI.goals[0].id
const kaiObjective = KAI.objectives[0].id
const sofiaMathGoal = SOFIA.goals[0].id

describe('lens.saveRun and the guardrail (PRD 1A-5)', () => {
  it('labels any outcome change as modification and blocks it when the IEP does not authorize the subject', () => {
    const sql = studentRoom('kai')
    const result = saveRun(sql, STUDENT_IDS.kai, 'math', [
      adaptation(kaiGoal),
      // The model claims "adaptation"; code decides.
      adaptation(kaiGoal, { adaptationType: 'modified_assessment', changesOutcome: true, modelLabel: 'adaptation', label: 'adaptation' }),
    ])
    const [gap, plain, changed] = result.suggestions
    expect(gap.kind).toBe('gap')
    expect(plain).toMatchObject({ kind: 'adaptation', label: 'adaptation', status: 'draft' })
    expect(changed).toMatchObject({ kind: 'adaptation', label: 'modification', status: 'blocked' })
  })

  it('stores an authorized modification as a draft (Sofía, math)', () => {
    const sql = studentRoom('sofia')
    const result = saveRun(sql, STUDENT_IDS.sofia, 'math', [adaptation(sofiaMathGoal, { changesOutcome: true, label: 'modification' })])
    expect(result.suggestions[1]).toMatchObject({ label: 'modification', status: 'draft' })
  })

  it('attaches embedded checks to the adaptation for their goal (PRD 1A-6)', () => {
    const sql = studentRoom('kai')
    const result = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)], [check(kaiGoal, kaiObjective)])
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].suggestionId).toBe(result.suggestions[1].id)
    expect(countRows(sql, 'audit_log')).toBeGreaterThan(1)
  })
})

describe('suggestion approval (PRD 1A-7)', () => {
  it('writes the status and the usage event in the same transaction', () => {
    const sql = studentRoom('kai')
    const s = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)]).suggestions[1]
    const res = runStudent<SuggestionResponse>(sql, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 1 }, ACTORS.teacher)
    expect(res.suggestion.status).toBe('approved')
    expect(res.usageEventId).not.toBeNull()
    expect(sql.get<{ suggestion_id: string; approved_by: string }>('SELECT * FROM usage_events')).toMatchObject({ suggestion_id: s.id, approved_by: ACTORS.teacher.userId })
  })

  it('leaves neither row when the usage event write fails', () => {
    const sql = studentRoom('kai')
    const s = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)]).suggestions[1]
    const auditBefore = countRows(sql, 'audit_log')
    const failing: SqlExecutor = {
      ...sql,
      run(query, ...params) {
        if (query.startsWith('INSERT INTO usage_events')) throw new Error('injected failure')
        return sql.run(query, ...params)
      },
    }
    expect(() => runStudent(failing, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 1 }, ACTORS.teacher)).toThrow('injected failure')
    expect(sql.get<{ status: string; version: number }>('SELECT status, version FROM suggestions WHERE id = ?', s.id)).toEqual({ status: 'draft', version: 1 })
    expect(countRows(sql, 'usage_events')).toBe(0)
    expect(countRows(sql, 'audit_log')).toBe(auditBefore)
  })

  it('refuses a blocked modification and writes nothing', () => {
    const sql = studentRoom('kai')
    const blocked = saveRun(sql, STUDENT_IDS.kai, 'math', [adaptation(kaiGoal, { changesOutcome: true })]).suggestions[1]
    expect(() => runStudent(sql, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: blocked.id, expectedVersion: 1 }, ACTORS.caseManager)).toThrow(
      /not_iep_authorized/,
    )
    expect(countRows(sql, 'usage_events')).toBe(0)
  })

  it('answers 409 on a stale expectedVersion', () => {
    const sql = studentRoom('kai')
    const s = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)]).suggestions[1]
    try {
      runStudent(sql, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 2 }, ACTORS.teacher)
      expect.unreachable()
    } catch (e) {
      expect((e as AltamiraError).status).toBe(409)
    }
  })

  it('refuses approval by an EA (view only)', () => {
    const sql = studentRoom('kai')
    const s = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)]).suggestions[1]
    expect(() => runStudent(sql, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 1 }, ACTORS.ea)).toThrow(/read_only/)
  })

  it('bulk approves per student, reporting blocked and conflicting items', () => {
    const sql = studentRoom('kai')
    const [, a, b, m] = saveRun(sql, STUDENT_IDS.kai, 'math', [adaptation(kaiGoal), adaptation(kaiGoal), adaptation(kaiGoal, { changesOutcome: true })]).suggestions
    const res = runStudent<{ approved: string[]; blocked: string[]; conflicts: string[] }>(
      sql,
      'suggestions.bulkApprove',
      { studentId: STUDENT_IDS.kai, items: [{ suggestionId: a.id, expectedVersion: 1 }, { suggestionId: b.id, expectedVersion: 5 }, { suggestionId: m.id, expectedVersion: 1 }] },
      ACTORS.teacher,
    )
    expect(res).toEqual({ approved: [a.id], blocked: [m.id], conflicts: [b.id] })
    expect(countRows(sql, 'usage_events')).toBe(1)
  })
})

describe('edit, regenerate, reject', () => {
  it('edit bumps the version and needs a fresh approval', () => {
    const sql = studentRoom('kai')
    const s = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)]).suggestions[1]
    const edited = runStudent<SuggestionResponse>(sql, 'suggestions.edit', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 1, content: { text: 'Shorter text.' } }, ACTORS.teacher)
    expect(edited.suggestion).toMatchObject({ status: 'edited', version: 2 })
    expect(edited.suggestion.kind === 'adaptation' && edited.suggestion.content.text).toBe('Shorter text.')
    const approved = runStudent<SuggestionResponse>(sql, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 2 }, ACTORS.teacher)
    expect(approved.suggestion.status).toBe('approved')
  })

  it('regenerate closes the old row, creates a new one and moves its checks', () => {
    const sql = studentRoom('kai')
    const run = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)], [check(kaiGoal, kaiObjective)])
    const old = run.suggestions[1]
    const res = runStudent<SuggestionResponse>(
      sql,
      'suggestions.regenerate',
      { studentId: STUDENT_IDS.kai, suggestionId: old.id, expectedVersion: 1, adaptation: adaptation(kaiGoal, { title: 'Visual steps', adaptationType: 'visual_supports' }) },
      ACTORS.teacher,
    )
    expect(res.suggestion.id).not.toBe(old.id)
    expect(sql.get<{ status: string }>('SELECT status FROM suggestions WHERE id = ?', old.id)?.status).toBe('rejected')
    expect(sql.get<{ suggestion_id: string }>('SELECT suggestion_id FROM checks')?.suggestion_id).toBe(res.suggestion.id)
  })

  it('reject records the reason in the audit log', () => {
    const sql = studentRoom('kai')
    const s = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)]).suggestions[1]
    runStudent(sql, 'suggestions.reject', { studentId: STUDENT_IDS.kai, suggestionId: s.id, expectedVersion: 1, reason: 'Not needed today' }, ACTORS.teacher)
    const row = sql.get<{ after_json: string }>("SELECT after_json FROM audit_log WHERE action = 'suggestions.reject'")
    expect(JSON.parse(row?.after_json ?? '{}').reason).toBe('Not needed today')
  })
})

describe('viewing lens output', () => {
  it('EAs see approved adaptations only, without answer keys', () => {
    const sql = studentRoom('kai')
    const run = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal), adaptation(kaiGoal)], [check(kaiGoal, kaiObjective)])
    runStudent(sql, 'suggestions.approve', { studentId: STUDENT_IDS.kai, suggestionId: run.suggestions[1].id, expectedVersion: 1 }, ACTORS.teacher)
    const view = runStudent<LensStudentResult>(sql, 'lens.get', { studentId: STUDENT_IDS.kai, lessonId: LESSON }, ACTORS.ea)
    expect(view.suggestions.map((s) => s.id)).toEqual([run.suggestions[1].id])
    expect(view.checks[0]).toMatchObject({ answerKey: null, rubric: null })
    const teacherView = runStudent<LensStudentResult>(sql, 'lens.get', { studentId: STUDENT_IDS.kai, lessonId: LESSON }, ACTORS.teacher)
    expect(teacherView.suggestions).toHaveLength(3)
    expect(teacherView.checks[0].answerKey).not.toBeNull()
  })

  it('a teacher can remove a check (PRD 1A-6)', () => {
    const sql = studentRoom('kai')
    const run = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)], [check(kaiGoal, kaiObjective)])
    runStudent(sql, 'checks.remove', { studentId: STUDENT_IDS.kai, checkId: run.checks[0].id, expectedVersion: 1 }, ACTORS.teacher)
    expect(runStudent<{ checks: unknown[] }>(sql, 'checks.list', { studentId: STUDENT_IDS.kai, lessonId: LESSON }, ACTORS.teacher).checks).toHaveLength(0)
  })

  it('profile view hides IEP text from EAs', () => {
    const sql = studentRoom('kai')
    const ea = runStudent<Record<string, unknown>>(sql, 'profile.get', { studentId: STUDENT_IDS.kai, displayToken: 'S-K7Q4', grade: '4' }, ACTORS.ea)
    expect(ea.view).toBe('supports')
    expect(JSON.stringify(ea)).not.toContain(KAI.goals[0].text)
    const cm = runStudent<Record<string, unknown>>(sql, 'profile.get', { studentId: STUDENT_IDS.kai, displayToken: 'S-K7Q4', grade: '4' }, ACTORS.caseManager)
    expect(cm.view).toBe('full')
  })
})
