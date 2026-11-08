import { z } from 'zod'
import { Id } from '../contract/common'
import { defineOp } from '../contract/ops'
import { headDataPoints } from '../repos/evidence'
import { currentIep, currentConfirmedObjectives } from '../repos/iep'
import { openReviewItems } from '../repos/evidence'
import { nowIso } from '../repos/base'
import { Now, StudentArgs, authorize } from './authz'
import { schoolDate } from './student-common'
import { DATA_NEEDED_MIN_POINTS, DATA_NEEDED_WINDOW_DAYS, daysToMs } from './thresholds'

/** GET /me/coming-up: scheduled work for the next 14 days, derived from the student rooms. */

export const COMING_UP_DAYS = 14

export const ComingUpItem = z.object({
  studentId: Id,
  kind: z.enum(['iep_meeting', 'review_queue', 'data_due']),
  /** School calendar date, YYYY-MM-DD. */
  date: z.string(),
  /** Count for review_queue items, objective count for data_due; null for meetings. */
  count: z.number().int().nullable(),
})
export type ComingUpItem = z.infer<typeof ComingUpItem>
export const ComingUpResponse = z.object({ items: z.array(ComingUpItem) })

export const comingUpList = defineOp({
  name: 'comingUp.list',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { items: ComingUpItem[] } {
    authorize(actor, 'progress.view', args.studentId)
    const at = nowIso(args.now)
    const today = schoolDate(at)
    const horizon = schoolDate(new Date(Date.parse(at) + daysToMs(COMING_UP_DAYS)).toISOString())
    const items: ComingUpItem[] = []

    const meeting = currentIep(sql)?.sections.reviewDate
    if (meeting && meeting >= today && meeting <= horizon) {
      items.push({ studentId: args.studentId, kind: 'iep_meeting', date: meeting, count: null })
    }

    const open = openReviewItems(sql).length
    if (open > 0) items.push({ studentId: args.studentId, kind: 'review_queue', date: today, count: open })

    // Data due: confirmed objectives with fewer than the minimum points in the data-needed window.
    const since = Date.parse(at) - daysToMs(DATA_NEEDED_WINDOW_DAYS)
    const due = currentConfirmedObjectives(sql).filter(
      (o) => headDataPoints(sql, { objectiveId: o.id, confirmedOnly: true }).filter((p) => Date.parse(p.recordedAt) >= since).length < DATA_NEEDED_MIN_POINTS,
    ).length
    if (due > 0) items.push({ studentId: args.studentId, kind: 'data_due', date: today, count: due })
    return { items }
  },
})

export const comingUpOpList = [comingUpList]
