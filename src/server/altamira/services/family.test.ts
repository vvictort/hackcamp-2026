import { afterEach, describe, expect, it } from 'vitest'
import type { TodayViewResponse } from '../contract/api'
import { AltamiraError } from '../contract/errors'
import { sessionActor } from '../contract/permissions'
import type { Consent, DataPoint, FamilySummary, Handoff, ProgressDraft } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { KAI, SOFIA, STUDENT_IDS, USER_IDS } from '../fixtures'
import { ACTORS, closeAll, countRows, runStudent, studentRoom } from './testing'

afterEach(closeAll)

const kai = STUDENT_IDS.kai
const confirmedPoint = 'd9000000-0000-4000-8000-0000000a2000'

type FamilyProgress = { goals: { goal: { id: string }; dataPoints: DataPoint[] }[]; summaries: FamilySummary[]; lessons: unknown[] }

function draftFor(sql: SqlExecutor, citations = [confirmedPoint]): ProgressDraft {
  return runStudent<{ draft: ProgressDraft }>(
    sql,
    'drafts.save',
    { studentId: kai, goalId: KAI.goals[1].id, period: 'T1', sentences: [{ text: 'More break-card use.', citations }], citationCheck: { valid: true } },
    ACTORS.teacher,
  ).draft
}

describe('consent records', () => {
  it('parents manage consent; the case manager records it for a named parent', () => {
    const sql = studentRoom('amara')
    const amara = STUDENT_IDS.amara
    const { consents } = runStudent<{ consents: Consent[] }>(sql, 'consents.set', { studentId: amara, kind: 'student_mode', granted: true }, ACTORS.parentAmara)
    expect(consents[0]).toMatchObject({ kind: 'student_mode', grantedBy: USER_IDS.parentAmara, recordedBy: USER_IDS.parentAmara, revokedAt: null })
    expect(() => runStudent(sql, 'consents.set', { studentId: amara, kind: 'audio', granted: true }, ACTORS.caseManager)).toThrow(/grantedBy/)
    runStudent(sql, 'consents.set', { studentId: amara, kind: 'audio', granted: true, grantedBy: USER_IDS.parentAmara }, ACTORS.caseManager)
    expect(() => runStudent(sql, 'consents.set', { studentId: amara, kind: 'audio', granted: true }, ACTORS.teacher)).toThrow(AltamiraError)
    runStudent(sql, 'consents.set', { studentId: amara, kind: 'student_mode', granted: false }, ACTORS.parentAmara)
    expect(() => runStudent(sql, 'sessions.start', { studentId: amara }, ACTORS.teacher)).toThrow(/consent/)
  })
})

describe('voice notes (PRD NFR Consent)', () => {
  const event = (objectiveId: string) => ({
    event: { objectiveId, kind: 'counter', promptLevel: null, count: 2, durationSeconds: null, confidence: 0.6 },
    routing: { status: 'pending_review', reviewKind: 'low_confidence' },
  })

  it('are refused without audio consent', () => {
    const sql = studentRoom('kai')
    expect(() => runStudent(sql, 'voiceNote.process', { studentId: kai, audioFileKey: 'audio/1.webm', events: [event(KAI.objectives[1].id)] }, ACTORS.ea)).toThrow(/audio consent/)
    expect(countRows(sql, 'data_points')).toBe(KAI.dataPoints.length)
  })

  it('become events on confirmed objectives only; the op never claims the audio is deleted', () => {
    const sql = studentRoom('sofia')
    const sofia = STUDENT_IDS.sofia
    const counter = SOFIA.objectives[1]
    const args = { studentId: sofia, audioFileKey: 'audio/2.webm', events: [event(counter.id)] }
    // Still proposed: the AI event is skipped, nothing is stored against it.
    const before = runStudent<{ dataPoints: DataPoint[]; skipped: number }>(sql, 'voiceNote.process', args, ACTORS.ea)
    expect(before).toEqual({ dataPoints: [], skipped: 1 })

    runStudent(sql, 'objectives.confirm', { studentId: sofia, objectiveId: counter.id, expectedVersion: counter.version }, ACTORS.caseManager)
    const res = runStudent<{ dataPoints: DataPoint[]; skipped: number }>(sql, 'voiceNote.process', args, ACTORS.ea)
    expect(res.skipped).toBe(0)
    expect(res.dataPoints[0]).toMatchObject({ value: 2, status: 'pending_review', recorderId: USER_IDS.ea })
    expect(res.dataPoints[0].sourceRef?.startsWith('ea_event:counter:voice-')).toBe(true)
    expect(sql.get("SELECT row_id FROM audit_log WHERE action = 'voice_notes.audio_deleted'")).toBeUndefined()
    expect(countRows(sql, 'review_queue')).toBe(1)

    // An event whose kind does not fit the metric is skipped, not a failure of the whole note.
    const timer = { ...event(counter.id), event: { ...event(counter.id).event, kind: 'timer', count: null, durationSeconds: 30 } }
    expect(runStudent<{ skipped: number }>(sql, 'voiceNote.process', { ...args, events: [timer] }, ACTORS.ea).skipped).toBe(1)
  })

  it('the deletion is audited by its own op, after the route deleted the file', () => {
    const sql = studentRoom('sofia')
    runStudent(sql, 'voiceNote.audioDeleted', { studentId: STUDENT_IDS.sofia, audioFileKey: 'audio/3.webm', processed: false }, ACTORS.ea)
    expect(sql.get("SELECT row_id FROM audit_log WHERE action = 'voice_notes.audio_deleted'")).toEqual({ row_id: 'audio/3.webm' })
  })
})

describe('Family Bridge (confirmed data only)', () => {
  it('family progress never returns pending points', () => {
    const sql = studentRoom('kai')
    const res = runStudent<FamilyProgress>(sql, 'family.progress', { studentId: kai }, ACTORS.parentKai)
    const points = res.goals.flatMap((g) => g.dataPoints)
    expect(points.length).toBe(8)
    expect(points.every((p) => p.status === 'confirmed' || p.status === 'auto_confirmed')).toBe(true)
    expect(() => runStudent(sql, 'family.progress', { studentId: kai }, ACTORS.parentAmara)).toThrow(/not_in_scope/)
  })

  it('summaries reach parents only after teacher approval', () => {
    const sql = studentRoom('kai')
    const draft = draftFor(sql)
    const { summary } = runStudent<{ summary: FamilySummary }>(sql, 'familySummaries.save', { studentId: kai, draftId: draft.id, language: 'ja', text: 'Kai uses his break card more.' }, ACTORS.teacher)
    expect(runStudent<FamilyProgress>(sql, 'family.progress', { studentId: kai }, ACTORS.parentKai).summaries).toEqual([])
    expect(() => runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: summary.id, expectedVersion: 1 }, ACTORS.ea)).toThrow(AltamiraError)
    runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: summary.id, expectedVersion: 1 }, ACTORS.teacher)
    expect(runStudent<FamilyProgress>(sql, 'family.progress', { studentId: kai }, ACTORS.parentKai).summaries).toHaveLength(1)
  })

  it('a summary cannot rest on a point that has since been corrected', () => {
    const sql = studentRoom('kai')
    const draft = draftFor(sql)
    runStudent(sql, 'dataPoints.correct', { studentId: kai, dataPointId: confirmedPoint, expectedVersion: 1, value: 0, reason: 'Wrong day' }, ACTORS.ea)
    expect(() => runStudent(sql, 'familySummaries.save', { studentId: kai, draftId: draft.id, language: 'en', text: 'x' }, ACTORS.teacher)).toThrow(/superseded/)
  })

  it('parents send input; only the case manager reads it', () => {
    const sql = studentRoom('kai')
    runStudent(sql, 'parentInput.create', { studentId: kai, text: 'Kai sleeps badly before swim days.', language: 'en' }, ACTORS.parentKai)
    expect(runStudent<{ inputs: unknown[] }>(sql, 'parentInput.list', { studentId: kai }, ACTORS.caseManager).inputs).toHaveLength(1)
    expect(() => runStudent(sql, 'parentInput.list', { studentId: kai }, ACTORS.teacher)).toThrow(AltamiraError)
    expect(() => runStudent(sql, 'parentInput.create', { studentId: kai, text: 'x', language: 'en' }, ACTORS.teacher)).toThrow(AltamiraError)
  })
})

describe('Today View', () => {
  const link = (expiresAt: string) => sessionActor({ kind: 'substitute_link', studentId: kai, tokenId: 'tv-1', expiresAt, startedBy: null })

  it('shows supports and approved materials, never other IEP text', () => {
    const sql = studentRoom('kai')
    const view = runStudent<TodayViewResponse>(
      sql,
      'todayView.get',
      { studentId: kai, lessons: [{ lessonId: 'l-1', title: 'Salmon life cycle' }], schedule: [{ className: 'Literacy', startsAt: '09:15', endsAt: '10:30' }], now: '2026-11-02T10:00:00.000Z' },
      link('2026-11-02T20:00:00.000Z'),
    )
    expect(view.firstName).toBe('Kai')
    expect(view.supports).toEqual(KAI.iep.sections.supports)
    expect(view.expiresAt).toBe('2026-11-02T20:00:00.000Z')
    const body = JSON.stringify(view)
    for (const s of [...KAI.iep.sections.goals.map((g) => g.text), KAI.iep.sections.profile.designation ?? '', ...KAI.iep.sections.accommodations]) {
      expect(body).not.toContain(s)
    }
  })

  it('refuses an expired link with 410', () => {
    const sql = studentRoom('kai')
    try {
      runStudent(sql, 'todayView.get', { studentId: kai, now: '2026-11-03T10:00:00.000Z' }, link('2026-11-02T20:00:00.000Z'))
      expect.unreachable()
    } catch (e) {
      expect((e as AltamiraError).status).toBe(410)
    }
  })

  it('a link reaches nothing but the Today View', () => {
    const sql = studentRoom('kai')
    const live = link('2099-01-01T00:00:00.000Z')
    expect(() => runStudent(sql, 'timeline.get', { studentId: kai }, live)).toThrow(AltamiraError)
    expect(() => runStudent(sql, 'profile.get', { studentId: kai, displayToken: 'x', grade: '4' }, live)).toThrow(/Today View/)
  })
})

describe('Transition Handoff', () => {
  it('packs per-goal trends, what works and current proficiency', () => {
    const sql = studentRoom('kai')
    const { handoff } = runStudent<{ handoff: Handoff }>(sql, 'handoffs.create', { studentId: kai, toSchool: 'Next school (fictional)' }, ACTORS.caseManager)
    const selfReg = handoff.packet.goals.find((g) => g.goalId === KAI.goals[1].id)
    expect(selfReg?.trend).toMatch(/^improving/)
    expect(selfReg?.proficiency).toBe('Emerging')
    // PRD: suggested next goals, one per current goal, from a rule on the confirmed data.
    expect(handoff.packet.suggestedNextGoals).toHaveLength(handoff.packet.goals.length)
    const selfRegArea = KAI.goals[1].area
    expect(handoff.packet.suggestedNextGoals.find((g) => g.startsWith(`${selfRegArea}:`))).toMatch(/raise the goal/)
    expect(runStudent<{ handoff: Handoff }>(sql, 'handoffs.get', { studentId: kai, handoffId: handoff.id }, ACTORS.teacher).handoff.id).toBe(handoff.id)
    expect(() => runStudent(sql, 'handoffs.create', { studentId: kai }, ACTORS.ea)).toThrow(AltamiraError)
  })
})
