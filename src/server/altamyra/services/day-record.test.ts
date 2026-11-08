import { afterEach, describe, expect, it } from 'vitest'
import { AltamyraError } from '../contract/errors'
import type { DataPoint, DayReview, Note, Video } from '../contract/student'
import { STUDENT_IDS } from '../fixtures'
import { addDays, categoryOf, dayBounds } from './day-record'
import { ACTORS, closeAll, runStudent, studentRoom } from '../e2e/testing'

afterEach(closeAll)

const kai = STUDENT_IDS.kai
const NOW = '2026-11-09T17:00:00.000Z'

describe('school day arithmetic', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('a school day runs midnight to midnight in Vancouver (PST and PDT)', () => {
    expect(dayBounds('2026-11-09')).toEqual({ from: '2026-11-09T08:00:00.000Z', to: '2026-11-10T08:00:00.000Z' })
    expect(dayBounds('2026-07-15')).toEqual({ from: '2026-07-15T07:00:00.000Z', to: '2026-07-16T07:00:00.000Z' })
  })

  it('splits points into events, voice notes and other data by source reference', () => {
    expect(categoryOf({ sourceRef: 'ea_event:counter:abc' })).toBe('events')
    expect(categoryOf({ sourceRef: 'ea_event:timer:voice-abc' })).toBe('voiceNotes')
    expect(categoryOf({ sourceRef: 'photo:file#q1' })).toBe('dataPoints')
    expect(categoryOf({ sourceRef: null })).toBe('dataPoints')
  })
})

describe('notes, videos and day reviews in the student room', () => {
  it('stores a note and audits it; refuses a missing objective and non-staff', () => {
    const sql = studentRoom('kai')
    const { note } = runStudent<{ note: Note }>(sql, 'notes.add', { studentId: kai, text: 'Fictional note.', now: NOW }, ACTORS.ea)
    expect(note).toMatchObject({ objectiveId: null, recorderId: ACTORS.ea.userId, recordedAt: NOW })
    expect(sql.get("SELECT row_id FROM audit_log WHERE action = 'notes.create'")).toEqual({ row_id: note.id })
    expect(() => runStudent(sql, 'notes.add', { studentId: kai, objectiveId: 'missing', text: 'x' }, ACTORS.ea)).toThrow(AltamyraError)
    for (const actor of [ACTORS.caseManager, ACTORS.parentKai]) expect(() => runStudent(sql, 'notes.add', { studentId: kai, text: 'x' }, actor)).toThrow(AltamyraError)
  })

  it('a video needs an active video consent inside the room too', () => {
    const sql = studentRoom('kai')
    sql.run("UPDATE consents SET revoked_at = ? WHERE kind = 'video'", NOW)
    const args = { studentId: kai, storageKey: 'uploads/v.mp4', contentType: 'video/mp4', sizeBytes: 10, now: NOW }
    expect(() => runStudent(sql, 'videos.add', args, ACTORS.ea)).toThrow(/consent_required/)
    runStudent(sql, 'consents.set', { studentId: kai, kind: 'video', granted: true, now: NOW }, ACTORS.parentKai)
    expect(runStudent<{ video: Video }>(sql, 'videos.add', args, ACTORS.ea).video.storageKey).toBe('uploads/v.mp4')
    expect(() => runStudent(sql, 'videos.add', { ...args, contentType: 'audio/webm' }, ACTORS.ea)).toThrow()
  })

  it('completing a day twice keeps one review and bumps its version', () => {
    const sql = studentRoom('kai')
    const first = runStudent<{ review: DayReview }>(sql, 'days.complete', { studentId: kai, date: '2026-11-09', now: NOW }, ACTORS.ea).review
    const second = runStudent<{ review: DayReview }>(sql, 'days.complete', { studentId: kai, date: '2026-11-09', note: 'Later.', now: NOW }, ACTORS.teacher).review
    expect(first.version).toBe(1)
    expect(second).toMatchObject({ version: 2, completedBy: ACTORS.teacher.userId, note: 'Later.' })
    expect(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM day_reviews')?.n).toBe(1)
    expect(() => runStudent(sql, 'days.complete', { studentId: kai, date: '2026-11-10', now: NOW }, ACTORS.ea)).toThrow(/future/)
  })

  it('the day list counts notes and shows reviewed days; points land on the school day they were recorded', () => {
    const sql = studentRoom('kai')
    // 2026-11-10 03:00 UTC is still 2026-11-09 in Vancouver.
    runStudent(sql, 'notes.add', { studentId: kai, text: 'Late note.', now: '2026-11-10T03:00:00.000Z' }, ACTORS.ea)
    runStudent(sql, 'notes.add', { studentId: kai, text: 'Next day.', now: '2026-11-10T17:00:00.000Z' }, ACTORS.ea)
    const { days } = runStudent<{ days: { date: string; counts: { notes: number }; reviewed: boolean }[] }>(sql, 'days.list', { studentId: kai, from: '2026-11-09', to: '2026-11-10', now: NOW }, ACTORS.ea)
    expect(days.map((d) => [d.date, d.counts.notes])).toEqual([['2026-11-09', 1], ['2026-11-10', 1]])
    const detail = runStudent<{ dataPoints: DataPoint[]; notes: Note[] }>(sql, 'days.get', { studentId: kai, date: '2026-11-09' }, ACTORS.ea)
    expect(detail.notes.map((n) => n.text)).toEqual(['Late note.'])
  })
})
