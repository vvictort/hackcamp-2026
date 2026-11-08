import type { Hono } from 'hono'
import {
  DayCompleteBody,
  DayCompleteResponse,
  DayDetailResponse,
  DaysQuery,
  DaysResponse,
  MyDayReviewResponse,
} from '../contract/api'
import { DateString } from '../contract/common'
import type { Summary } from '../contract/student'
import type { AltamyraEnv } from '../middleware/auth'
import { AltamyraError } from '../contract/errors'
import { dayReviewToday, daysComplete, daysGet, daysList } from '../services/day-record'
import { familySummariesList } from '../services/summaries'
import type { Kit, Req } from './context'
import { draftSummary, studentToken } from './student-flows'

function dateParam(r: Req): string {
  const parsed = DateString.safeParse(r.param('date'))
  if (!parsed.success) throw new AltamyraError('bad_request', 'The date must look like YYYY-MM-DD.')
  return parsed.data
}

/** The daily record: days list, one day in full, the end-of-day review. */
export function daysRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, req } = kit

  /** Day-by-day record (default: the last 30 days). The case manager sees confirmed data only. */
  app.get('/students/:id/days', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(DaysResponse, await r.student(r.param('id'), daysList, r.query(DaysQuery)))
  })

  /** Everything logged on one day. */
  app.get('/students/:id/days/:date', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(DayDetailResponse, await r.student(r.param('id'), daysGet, { date: dateParam(r) }))
  })

  /** Finishes the day for this child and drafts the daily summary (a draft until an EA or teacher approves it). */
  app.post('/students/:id/days/:date/complete', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const date = dateParam(r)
    const body = await r.body(DayCompleteBody)
    const { review } = await r.student(studentId, daysComplete, { date, note: body.note ?? null })
    let dailySummary: Summary | null = null
    try {
      dailySummary = await draftSummary(r, studentId, { kind: 'daily', period: date })
    } catch (err) {
      if (err instanceof AltamyraError && err.code === 'bad_request') {
        // Already approved: keep it as it is.
        dailySummary = (await r.student(studentId, familySummariesList, { kind: 'daily' })).summaries.find((s) => s.period === date) ?? null
      } else if (err instanceof AltamyraError) {
        throw err
      } else {
        // The review is done; the summary can be generated again from the day's page.
        console.error('altamyra: daily summary draft failed')
      }
    }
    return r.json(DayCompleteResponse, { review, dailySummary })
  })

  /** EA and teacher: the children they helped today, for the end-of-day review. All assigned students are included. */
  app.get('/me/day-review', signedIn, async (c) => {
    const r = req(c)
    const students = []
    let date = r.today()
    for (const studentId of r.staffStudentIds().filter((id) => r.can('evidence.capture', id))) {
      const today = await r.student(studentId, dayReviewToday)
      date = today.date
      students.push({ studentId, label: (await studentToken(r, studentId)).token, entriesToday: today.entriesToday, reviewed: today.reviewed })
    }
    students.sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || b.entriesToday - a.entriesToday || a.label.localeCompare(b.label))
    return r.json(MyDayReviewResponse, { date, students })
  })
}
