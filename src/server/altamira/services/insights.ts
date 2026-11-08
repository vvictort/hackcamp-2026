import { z } from 'zod'
import { Id } from '../contract/common'
import { AltamiraError } from '../contract/errors'
import { CounterIncrement, INSIGHT_DIMENSIONS, InsightDimension, MIN_GROUP_SIZE } from '../contract/insights'
import { defineOp } from '../contract/ops'
import type { SqlExecutor, SqlParam } from '../db/sql'
import { newId } from '../repos/base'
import { authorize } from './authz'

/** Insights-room ops (M5): de-identified counters only; groups under 10 students are suppressed. */

const DIMENSION_COLUMNS: Record<InsightDimension, string> = {
  schoolId: 'school_id',
  goalArea: 'goal_area',
  proficiencyLevel: 'proficiency_level',
  label: 'label',
  reviewTimeliness: 'review_timeliness',
  period: 'period',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function applyIncrement(sql: SqlExecutor, districtId: string, inc: CounterIncrement): void {
  const key: SqlParam[] = [districtId, inc.schoolId, inc.period, inc.studentKey, inc.goalArea ?? '', inc.proficiencyLevel ?? '', inc.label ?? '', inc.reviewTimeliness ?? '']
  const existing = sql.get<{ id: string }>(
    `SELECT id FROM counters WHERE district_id = ? AND school_id = ? AND period = ? AND student_key = ?
     AND IFNULL(goal_area, '') = ? AND IFNULL(proficiency_level, '') = ? AND IFNULL(label, '') = ? AND IFNULL(review_timeliness, '') = ?`,
    ...key,
  )
  if (existing) {
    sql.run('UPDATE counters SET count = count + ?, version = version + 1 WHERE id = ?', inc.by, existing.id)
    return
  }
  sql.run(
    `INSERT INTO counters (id, district_id, school_id, period, student_key, goal_area, proficiency_level, label, review_timeliness, count, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    newId(),
    districtId,
    inc.schoolId,
    inc.period,
    inc.studentKey,
    inc.goalArea,
    inc.proficiencyLevel,
    inc.label,
    inc.reviewTimeliness,
    inc.by,
  )
}

/** Pushed by the route after a confirmed data point. The student key must already be a one-way hash. */
export const countersPush = defineOp({
  name: 'counters.push',
  room: 'insights',
  args: z.object({ districtId: Id, increments: z.array(CounterIncrement).min(1) }),
  run(sql, args): { applied: number } {
    for (const inc of args.increments) {
      // De-identified only: a raw student id never enters this room.
      if (UUID.test(inc.studentKey)) throw new AltamiraError('bad_request', 'studentKey must be a hash, not a student id')
      applyIncrement(sql, args.districtId, inc)
    }
    return { applied: args.increments.length }
  },
})

export type InsightGroup = { dims: Record<string, string | null>; students: number | null; count: number | null; suppressed: boolean }

/** PRD District Insights: no group under 10 students is ever displayed. */
export function suppressSmallGroups(rows: { dims: Record<string, string | null>; students: number; count: number }[]): InsightGroup[] {
  return rows.map((r) =>
    r.students < MIN_GROUP_SIZE
      ? { dims: r.dims, students: null, count: null, suppressed: true }
      : { dims: r.dims, students: r.students, count: r.count, suppressed: false },
  )
}

export const insightsGet = defineOp({
  name: 'insights.get',
  room: 'insights',
  capability: 'insights.view',
  args: z.object({
    districtId: Id,
    period: z.string().optional(),
    groupBy: z.array(InsightDimension).min(1).default(['goalArea']),
  }),
  run(sql, args, actor): { groups: InsightGroup[] } {
    authorize(actor, 'insights.view', null, { districtId: args.districtId })
    const dims = INSIGHT_DIMENSIONS.filter((d) => args.groupBy.includes(d))
    const cols = dims.map((d) => DIMENSION_COLUMNS[d])
    const where = args.period ? 'district_id = ? AND period = ?' : 'district_id = ?'
    const params: SqlParam[] = args.period ? [args.districtId, args.period] : [args.districtId]
    const rows = sql.all<Record<string, SqlParam>>(
      `SELECT ${cols.join(', ')}, COUNT(DISTINCT student_key) AS students, SUM(count) AS total
       FROM counters WHERE ${where} GROUP BY ${cols.join(', ')} ORDER BY ${cols.join(', ')}`,
      ...params,
    )
    return {
      groups: suppressSmallGroups(
        rows.map((r) => ({
          dims: Object.fromEntries(dims.map((d) => [d, r[DIMENSION_COLUMNS[d]] === null ? null : String(r[DIMENSION_COLUMNS[d]])])),
          students: Number(r.students),
          count: Number(r.total),
        })),
      ),
    }
  },
})

export const insightsOpList = [countersPush, insightsGet]
