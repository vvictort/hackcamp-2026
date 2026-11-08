import { afterEach, describe, expect, it } from 'vitest'
import type { LensStudentResult, SessionNextResponse } from '../contract/api'
import { AltamiraError } from '../contract/errors'
import { sessionActor } from '../contract/permissions'
import type { DataPoint } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { KAI, STUDENT_IDS, USER_IDS } from '../fixtures'
import { scoreItem } from './scoring'
import { ACTORS, closeAll, runStudent, studentRoom } from './testing'

afterEach(closeAll)

const kai = STUDENT_IDS.kai
const NOW = '2026-11-02T18:00:00.000Z'
const session = (studentId: string = kai, expiresAt = '2026-11-02T18:30:00.000Z') =>
  sessionActor({ kind: 'student_session', studentId, tokenId: 'sess-1', expiresAt, startedBy: USER_IDS.ea })

/** Kai with one approved adaptation carrying a numeric check. */
function kaiWithApprovedCheck(): SqlExecutor {
  const sql = studentRoom('kai')
  const run = runStudent<LensStudentResult>(
    sql,
    'lens.saveRun',
    {
      studentId: kai,
      lessonId: 'lesson-1',
      analysisId: 'analysis-1',
      subject: 'literacy',
      gaps: [],
      adaptations: [
        { adaptationType: 'visual_supports', title: 'Picture steps', text: 'Use the picture steps.', why: 'Visual schedule', goalIds: [KAI.goals[0].id], changesOutcome: false, modelLabel: 'adaptation', label: 'adaptation' },
      ],
      checks: [
        {
          goalId: KAI.goals[0].id,
          objectiveId: KAI.objectives[0].id,
          items: [
            { id: 'q1', prompt: 'How many salmon swam upstream? 7 + 5', format: 'numeric', options: null },
            { id: 'q2', prompt: 'Draw the river', format: 'work_sample', options: null },
          ],
          answerKey: [{ itemId: 'q1', accepted: ['12'] }, { itemId: 'q2', accepted: ['n/a'] }],
          rubric: null,
        },
      ],
    },
    ACTORS.teacher,
  )
  runStudent(sql, 'suggestions.approve', { studentId: kai, suggestionId: run.suggestions[0].id, expectedVersion: 1 }, ACTORS.teacher)
  return sql
}

/** Every IEP string that must never reach student mode. */
const iepStrings = [
  ...KAI.iep.sections.goals.map((g) => g.text),
  ...KAI.iep.sections.accommodations,
  ...KAI.iep.sections.supports,
  KAI.iep.sections.profile.designation ?? '',
  ...KAI.iep.sections.profile.stretches,
]

describe('consent gate (PRD NFR Consent)', () => {
  it('blocks student mode without an active consent row', () => {
    const sql = studentRoom('amara')
    expect(() => runStudent(sql, 'sessions.start', { studentId: STUDENT_IDS.amara }, ACTORS.teacher)).toThrow(/consent/)
  })

  it('allows it with consent, started by an adult only', () => {
    const sql = studentRoom('kai')
    const res = runStudent<{ supports: Record<string, unknown> }>(sql, 'sessions.start', { studentId: kai }, ACTORS.ea)
    expect(res.supports).toEqual({ readAloud: true, largerText: false, fewerItems: false, visualSupports: true, breakTimerMinutes: 5 })
    expect(() => runStudent(sql, 'sessions.start', { studentId: kai }, ACTORS.parentKai)).toThrow(AltamiraError)
  })

  it('stops a running session once consent is revoked', () => {
    const sql = kaiWithApprovedCheck()
    runStudent(sql, 'consents.set', { studentId: kai, kind: 'student_mode', granted: false }, ACTORS.parentKai)
    expect(() => runStudent(sql, 'sessions.next', { studentId: kai, now: NOW }, session())).toThrow(/consent/)
  })
})

describe('student-mode sessions', () => {
  it('delivers objective items with supports and never any IEP text', () => {
    const sql = kaiWithApprovedCheck()
    const next = runStudent<SessionNextResponse>(sql, 'sessions.next', { studentId: kai, now: NOW }, session())
    expect(next.item?.prompt).toBe('How many salmon swam upstream? 7 + 5')
    const body = JSON.stringify(next)
    for (const s of iepStrings) expect(body).not.toContain(s)
  })

  it('scores responses deterministically against the key and stores them auto-confirmed', () => {
    const sql = kaiWithApprovedCheck()
    const next = runStudent<SessionNextResponse>(sql, 'sessions.next', { studentId: kai, now: NOW }, session())
    const res = runStudent<{ correct: boolean }>(sql, 'sessions.respond', { studentId: kai, itemId: next.item?.itemId, response: ' 12 ', now: NOW }, session())
    expect(res.correct).toBe(true)
    const dp = sql.get<{ value: number; status: string; source: string; source_ref: string; recorder_id: string }>(
      "SELECT value, status, source, source_ref, recorder_id FROM data_points WHERE source = 'student'",
    )
    expect(dp).toMatchObject({ value: 100, status: 'auto_confirmed', source: 'student', recorder_id: USER_IDS.ea })
    expect(dp?.source_ref.startsWith('student_response:sess-1:')).toBe(true)
    // Work samples are never scored in code, so the session is done.
    expect(runStudent<SessionNextResponse>(sql, 'sessions.next', { studentId: kai, now: NOW }, session()).item).toBeNull()
    expect(() => runStudent(sql, 'sessions.respond', { studentId: kai, itemId: next.item?.itemId, response: '12', now: NOW }, session())).toThrow(/already answered/)
  })

  it('shows strengths-based self progress without IEP wording', () => {
    const sql = kaiWithApprovedCheck()
    const next = runStudent<SessionNextResponse>(sql, 'sessions.next', { studentId: kai, now: NOW }, session())
    runStudent(sql, 'sessions.respond', { studentId: kai, itemId: next.item?.itemId, response: '12', now: NOW }, session())
    const progress = runStudent<{ goals: { label: string; completed: number; streak: number }[] }>(sql, 'sessions.progress', { studentId: kai, now: NOW }, session())
    expect(progress.goals[0]).toEqual({ label: 'Practice 1', completed: 1, streak: 1 })
    for (const s of iepStrings) expect(JSON.stringify(progress)).not.toContain(s)
  })

  it('refuses expired sessions (410), other students and non-session callers', () => {
    const sql = kaiWithApprovedCheck()
    try {
      runStudent(sql, 'sessions.next', { studentId: kai, now: '2026-11-02T19:00:00.000Z' }, session())
      expect.unreachable()
    } catch (e) {
      expect((e as AltamiraError).status).toBe(410)
    }
    expect(() => runStudent(sql, 'sessions.next', { studentId: STUDENT_IDS.sofia, now: NOW }, session())).toThrow(/not_in_scope/)
    expect(() => runStudent(sql, 'sessions.next', { studentId: kai, now: NOW }, ACTORS.teacher)).toThrow(/student session/)
    const live = session(kai, '2099-01-01T00:00:00.000Z')
    expect(() => runStudent(sql, 'timeline.get', { studentId: kai, now: NOW }, live)).toThrow(/sessions/)
    const profile = runStudent<Record<string, unknown>>(sql, 'profile.get', { studentId: kai, displayToken: 'x', grade: '4' }, live)
    expect(profile.view).toBe('supports')
    for (const goal of KAI.iep.sections.goals) expect(JSON.stringify(profile)).not.toContain(goal.text)
  })

  it('delivers scheduled probes first, recorded with source probe', () => {
    const sql = kaiWithApprovedCheck()
    runStudent(
      sql,
      'probes.schedule',
      {
        studentId: kai,
        objectiveId: KAI.objectives[0].id,
        skill: 'retell',
        level: 'grade 2',
        form: { items: [{ id: 'p1', prompt: 'Pick the main idea', format: 'multiple_choice', options: ['Rivers', 'Trains'] }], answerKey: [{ itemId: 'p1', accepted: ['Rivers'] }], timeLimitSeconds: null },
      },
      ACTORS.teacher,
    )
    const next = runStudent<SessionNextResponse>(sql, 'sessions.next', { studentId: kai, now: NOW }, session())
    expect(next.item?.prompt).toBe('Pick the main idea')
    runStudent(sql, 'sessions.respond', { studentId: kai, itemId: next.item?.itemId, response: 'trains', now: NOW }, session())
    const dp = runStudent<{ dataPoints: DataPoint[] }>(sql, 'timeline.get', { studentId: kai }, ACTORS.caseManager).dataPoints.find((p) => p.source === 'probe')
    expect(dp?.value).toBe(0)
  })
})

describe('scoreItem', () => {
  const item = (format: 'numeric' | 'short_answer' | 'multiple_choice' | 'work_sample') => ({ id: 'i', prompt: 'p', format, options: null })
  it('compares numbers, normalised text and choices; never scores work samples', () => {
    expect(scoreItem(item('numeric'), { itemId: 'i', accepted: ['12'] }, '12.0')).toBe(true)
    expect(scoreItem(item('numeric'), { itemId: 'i', accepted: ['12'] }, 'twelve')).toBe(false)
    expect(scoreItem(item('short_answer'), { itemId: 'i', accepted: ['The river'] }, '  the   RIVER. ')).toBe(true)
    expect(scoreItem(item('multiple_choice'), { itemId: 'i', accepted: ['B'] }, 'c')).toBe(false)
    expect(scoreItem(item('work_sample'), { itemId: 'i', accepted: ['x'] }, 'x')).toBeNull()
    expect(scoreItem(item('numeric'), undefined, '1')).toBeNull()
  })
})
