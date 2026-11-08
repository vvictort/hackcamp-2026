import { afterEach, describe, expect, it } from 'vitest'
import { AltamiraError } from '../contract/errors'
import type { Consent, DataPoint, FamilySummary } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { KAI, SOFIA, STUDENT_IDS, USER_IDS } from '../fixtures'
import { ACTORS, closeAll, countRows, runStudent, studentRoom } from './testing'

afterEach(closeAll)

const kai = STUDENT_IDS.kai
describe('consent records', () => {
  it('only the parent manages consent, for voice notes and videos', () => {
    const sql = studentRoom('amara')
    const amara = STUDENT_IDS.amara
    const { consents } = runStudent<{ consents: Consent[] }>(sql, 'consents.set', { studentId: amara, kind: 'voice_note', granted: true }, ACTORS.parentAmara)
    expect(consents[0]).toMatchObject({ kind: 'voice_note', grantedBy: USER_IDS.parentAmara, recordedBy: USER_IDS.parentAmara, revokedAt: null })
    runStudent(sql, 'consents.set', { studentId: amara, kind: 'video', granted: true }, ACTORS.parentAmara)
    for (const actor of [ACTORS.caseManager, ACTORS.teacher, ACTORS.ea, ACTORS.parentKai]) {
      expect(() => runStudent(sql, 'consents.set', { studentId: amara, kind: 'voice_note', granted: true }, actor)).toThrow(AltamiraError)
    }
    expect(() => runStudent(sql, 'consents.set', { studentId: amara, kind: 'student_mode', granted: true }, ACTORS.parentAmara)).toThrow()
    const revoked = runStudent<{ consents: Consent[] }>(sql, 'consents.set', { studentId: amara, kind: 'voice_note', granted: false }, ACTORS.parentAmara)
    expect(revoked.consents.find((c) => c.kind === 'voice_note')?.revokedAt).not.toBeNull()
  })
})

describe('voice notes (PRD NFR Consent)', () => {
  const event = (objectiveId: string) => ({
    event: { objectiveId, kind: 'counter', promptLevel: null, count: 2, durationSeconds: null, confidence: 0.6 },
    routing: { status: 'pending_review', reviewKind: 'low_confidence' },
  })

  it('are refused without voice-note consent', () => {
    const sql = studentRoom('kai')
    expect(() => runStudent(sql, 'voiceNote.process', { studentId: kai, audioFileKey: 'audio/1.webm', events: [event(KAI.objectives[1].id)] }, ACTORS.ea)).toThrow(/voice_note consent/)
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

describe('summaries (AI drafts need EA or teacher approval)', () => {
  const save = (sql: SqlExecutor, actor = ACTORS.teacher) =>
    runStudent<{ summary: FamilySummary }>(sql, 'familySummaries.save', { studentId: kai, language: 'ja', text: 'Kai uses his break card more.' }, actor).summary
  const list = (sql: SqlExecutor, actor: typeof ACTORS.parentKai) => runStudent<{ summaries: FamilySummary[] }>(sql, 'familySummaries.list', { studentId: kai }, actor).summaries

  it('a draft reaches parents and the case manager only after approval', () => {
    const sql = studentRoom('kai')
    const summary = save(sql)
    expect(summary.status).toBe('draft')
    expect(list(sql, ACTORS.parentKai)).toEqual([])
    expect(list(sql, ACTORS.caseManager)).toEqual([])
    // The EA and the teacher see the draft.
    expect(list(sql, ACTORS.ea)).toHaveLength(1)
    expect(list(sql, ACTORS.teacher)).toHaveLength(1)
    runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: summary.id, expectedVersion: 1 }, ACTORS.ea)
    expect(list(sql, ACTORS.parentKai)).toHaveLength(1)
    expect(list(sql, ACTORS.caseManager)).toHaveLength(1)
  })

  it('either the EA or the teacher approves, and may edit the text first', () => {
    const sql = studentRoom('kai')
    const { summary } = runStudent<{ summary: FamilySummary }>(sql, 'familySummaries.approve', { studentId: kai, summaryId: save(sql).id, expectedVersion: 1, text: 'Edited by the teacher.' }, ACTORS.teacher)
    expect(summary).toMatchObject({ status: 'approved', text: 'Edited by the teacher.', approvedBy: USER_IDS.teacher })
  })

  it('parents, the case manager and others can neither write nor approve', () => {
    const sql = studentRoom('kai')
    const summary = save(sql)
    for (const actor of [ACTORS.parentKai, ACTORS.caseManager, ACTORS.districtLead]) {
      expect(() => save(sql, actor)).toThrow(AltamiraError)
      expect(() => runStudent(sql, 'familySummaries.approve', { studentId: kai, summaryId: summary.id, expectedVersion: 1 }, actor)).toThrow(AltamiraError)
    }
  })

  it('a parent reads only their own child', () => {
    const sql = studentRoom('kai')
    expect(() => list(sql, ACTORS.parentAmara)).toThrow(/not_in_scope/)
  })
})

describe('removed features', () => {
  it('have no ops', () => {
    const sql = studentRoom('kai')
    for (const op of ['parentInput.create', 'parentInput.list', 'todayView.get', 'handoffs.create', 'handoffs.get', 'drafts.save', 'proposals.create', 'digest.weekly', 'sessions.start', 'family.progress']) {
      expect(() => runStudent(sql, op, { studentId: kai }, ACTORS.teacher)).toThrow(/no op/)
    }
  })
})
