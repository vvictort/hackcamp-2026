import { z } from 'zod'
import { DateString, Id } from '../contract/common'
import { AltamyraError } from '../contract/errors'
import { defineOp, type SqlExecutor } from '../contract/ops'
import type { Allowed } from './authz'
import type { DataPoint, DayReview, Note, Summary, Video } from '../contract/student'
import { audit, insertEntity, newId, nowIso } from '../repos/base'
import { headDataPoints } from '../repos/evidence'
import * as records from '../repos/records'
import { Now, StudentArgs, authorize, authorizeStaff } from './authz'
import { dayStart, requireConsent, requireObjective, schoolDate } from './student-common'
import { DAY_MS } from './thresholds'

/**
 * The daily record: typed notes, videos, per-day detail and the end-of-day
 * review. A "day" is a school day in the school's time zone.
 */

/** Date arithmetic on YYYY-MM-DD strings. */
export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T12:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10)

/** [from, to) timestamps of one school day. */
export function dayBounds(date: string): { from: string; to: string } {
  return { from: dayStart(`${date}T20:00:00.000Z`), to: dayStart(`${addDays(date, 1)}T20:00:00.000Z`) }
}

/** [from, to) timestamps of the school days firstDate..lastDate. */
export const rangeBounds = (firstDate: string, lastDate: string) => ({ from: dayBounds(firstDate).from, to: dayBounds(lastDate).to })

export type DayCategory = 'dataPoints' | 'events' | 'voiceNotes'

/** Events and voice notes carry an ea_event source reference; voice-note points have an id that starts with "voice-". */
export function categoryOf(p: Pick<DataPoint, 'sourceRef'>): DayCategory {
  if (!p.sourceRef?.startsWith('ea_event:')) return 'dataPoints'
  return (p.sourceRef.split(':')[2] ?? '').startsWith('voice-') ? 'voiceNotes' : 'events'
}

export const DayCounts = z.object({
  dataPoints: z.number().int(),
  events: z.number().int(),
  notes: z.number().int(),
  videos: z.number().int(),
  voiceNotes: z.number().int(),
})
export type DayCounts = z.infer<typeof DayCounts>

const emptyCounts = (): DayCounts => ({ dataPoints: 0, events: 0, notes: 0, videos: 0, voiceNotes: 0 })

/** Staff who captured data see everything; the case manager sees confirmed data only. */
const confirmedOnly = (allowed: Allowed): boolean => allowed.role !== 'ea' && allowed.role !== 'teacher'

// ---------- typed notes ----------

export const notesAdd = defineOp({
  name: 'notes.add',
  room: 'student',
  args: StudentArgs.extend({ objectiveId: Id.nullable().default(null), text: z.string().trim().min(1).max(2000) }).extend(Now.shape),
  run(sql, args, actor): { note: Note } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    if (args.objectiveId) requireObjective(sql, args.objectiveId)
    const at = nowIso(args.now)
    const note: Note = { id: newId(), objectiveId: args.objectiveId, text: args.text, recorderId: actor.userId, recordedAt: at, version: 1 }
    insertEntity(sql, 'notes', note)
    audit(sql, actor, 'notes.create', 'notes', note.id, undefined, { objectiveId: note.objectiveId }, at)
    return { note }
  },
})

// ---------- videos ----------

export const videosAdd = defineOp({
  name: 'videos.add',
  room: 'student',
  args: StudentArgs.extend({
    storageKey: z.string().min(1),
    contentType: z.string().regex(/^video\//),
    sizeBytes: z.number().int().min(0),
    objectiveId: Id.nullable().default(null),
    recordedAt: z.string().optional(),
  }).extend(Now.shape),
  run(sql, args, actor): { video: Video } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    try {
      requireConsent(sql, 'video')
    } catch {
      throw new AltamyraError('forbidden', "consent_required: videos need the parent or guardian's consent.")
    }
    if (args.objectiveId) requireObjective(sql, args.objectiveId)
    const at = nowIso(args.now)
    const video: Video = {
      id: newId(),
      storageKey: args.storageKey,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      objectiveId: args.objectiveId,
      recorderId: actor.userId,
      recordedAt: args.recordedAt ?? at,
      version: 1,
    }
    insertEntity(sql, 'videos', video)
    audit(sql, actor, 'videos.create', 'videos', video.id, undefined, { contentType: video.contentType, sizeBytes: video.sizeBytes }, at)
    return { video }
  },
})

// ---------- days ----------

type Day = { date: string; counts: DayCounts; reviewed: boolean }

/** Everything recorded in [from, to) grouped by school day. */
function collectDays(sql: SqlExecutor, firstDate: string, lastDate: string, onlyConfirmed: boolean): Day[] {
  const { from, to } = rangeBounds(firstDate, lastDate)
  const days = new Map<string, DayCounts>()
  const bump = (iso: string, key: keyof DayCounts) => {
    const date = schoolDate(iso)
    const counts = days.get(date) ?? emptyCounts()
    counts[key] += 1
    days.set(date, counts)
  }
  for (const p of headDataPoints(sql, { from, to: addMs(to), confirmedOnly: onlyConfirmed })) {
    bump(p.recordedAt, categoryOf(p))
  }
  for (const n of records.notesBetween(sql, from, to)) bump(n.recordedAt, 'notes')
  for (const v of records.videosBetween(sql, from, to)) bump(v.recordedAt, 'videos')
  const reviews = new Set(records.dayReviewsBetween(sql, firstDate, lastDate).map((r) => r.date))
  for (const date of reviews) if (!days.has(date)) days.set(date, emptyCounts())
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, counts, reviewed: reviews.has(date) }))
}

/** headDataPoints compares recorded_at <= to; one millisecond back keeps the upper bound exclusive. */
const addMs = (iso: string): string => new Date(Date.parse(iso) - 1).toISOString()

export const daysList = defineOp({
  name: 'days.list',
  room: 'student',
  args: StudentArgs.extend({ from: DateString.optional(), to: DateString.optional() }).extend(Now.shape),
  run(sql, args, actor): { days: Day[] } {
    const allowed = authorize(actor, 'progress.view', args.studentId)
    const today = schoolDate(nowIso(args.now))
    const to = args.to ?? today
    const from = args.from ?? addDays(to, -29)
    if (from > to) throw new AltamyraError('bad_request', 'from must not be after to')
    if (Date.parse(to) - Date.parse(from) > 366 * DAY_MS) throw new AltamyraError('bad_request', 'The range can be at most one year.')
    return { days: collectDays(sql, from, to, confirmedOnly(allowed)) }
  },
})

export type DayDetail = {
  date: string
  dataPoints: DataPoint[]
  events: DataPoint[]
  notes: Note[]
  videos: Video[]
  voiceNotes: DataPoint[]
  review: DayReview | null
  dailySummary: Summary | null
}

export function dayDetail(sql: SqlExecutor, date: string, allowed: Allowed): DayDetail {
  const { from, to } = dayBounds(date)
  const detail: DayDetail = {
    date,
    dataPoints: [],
    events: [],
    notes: records.notesBetween(sql, from, to),
    videos: records.videosBetween(sql, from, to),
    voiceNotes: [],
    review: records.dayReviewOf(sql, date) ?? null,
    // A daily summary is for the EA and the teacher only; a draft stays theirs until approved.
    dailySummary: confirmedOnly(allowed) ? null : (records.summaryFor(sql, 'daily', date) ?? null),
  }
  for (const p of headDataPoints(sql, { from, to: addMs(to), confirmedOnly: confirmedOnly(allowed) })) detail[categoryOf(p)].push(p)
  return detail
}

export const daysGet = defineOp({
  name: 'days.get',
  room: 'student',
  args: StudentArgs.extend({ date: DateString }),
  run(sql, args, actor): DayDetail {
    return dayDetail(sql, args.date, authorize(actor, 'progress.view', args.studentId))
  },
})

/** Marks the end-of-day review done. The route drafts the daily summary afterwards. */
export const daysComplete = defineOp({
  name: 'days.complete',
  room: 'student',
  args: StudentArgs.extend({ date: DateString, note: z.string().trim().max(2000).nullable().default(null) }).extend(Now.shape),
  run(sql, args, actor): { review: DayReview } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const at = nowIso(args.now)
    if (args.date > schoolDate(at)) throw new AltamyraError('bad_request', 'A future day cannot be reviewed.')
    const before = records.dayReviewOf(sql, args.date)
    if (before) {
      sql.run('UPDATE day_reviews SET completed_by = ?, completed_at = ?, note = ?, version = version + 1 WHERE date = ?', actor.userId, at, args.note, args.date)
    } else {
      insertEntity(sql, 'day_reviews', { date: args.date, completedBy: actor.userId, completedAt: at, note: args.note, version: 1 })
    }
    const review = records.dayReviewOf(sql, args.date)
    if (!review) throw new AltamyraError('not_found', 'day review was not saved')
    audit(sql, actor, 'day_reviews.complete', 'day_reviews', args.date, before, review, at)
    return { review }
  },
})

/** One student's line in the EA/teacher end-of-day review: entries today and whether the day is already reviewed. */
export const dayReviewToday = defineOp({
  name: 'dayReview.today',
  room: 'student',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { date: string; entriesToday: number; reviewed: boolean } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const date = schoolDate(nowIso(args.now))
    const day = collectDays(sql, date, date, false).find((d) => d.date === date)
    const c = day?.counts
    return { date, entriesToday: c ? c.dataPoints + c.events + c.notes + c.videos + c.voiceNotes : 0, reviewed: day?.reviewed ?? false }
  },
})

export const dayRecordOpList = [notesAdd, videosAdd, daysList, daysGet, daysComplete, dayReviewToday]
