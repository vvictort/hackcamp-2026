import type { ConsentKind, GoalProgress, Label, Proficiency, ReviewTimeliness } from '../contract/enums'
import type { DecisionOutcome } from '../services/analytics'
import { evaluateObjective } from '../services/measurement'
import { objectiveById } from '../repos/iep'
import type { CounterIncrement } from '../contract/insights'
import type { SqlExecutor } from '../db/sql'

/** Pure student-room helpers used by AltamyraStudentRoom, testable on node:sqlite. */

const CONFIRMED = "('confirmed', 'auto_confirmed')"

/**
 * Data points that became confirmed during the op that started at `mark`.
 * Ops audit every write to data_points (README "Execution model"), so a point
 * counts when an audit row after the mark names it, it is confirmed now, it was
 * never audited as confirmed before, and it does not correct a point that was
 * already confirmed (corrections insert a new row with supersedes_id).
 */
export function confirmedDataPointsSince(sql: SqlExecutor, mark: number): string[] {
  const rows = sql.all<{ id: string }>(
    `SELECT DISTINCT d.id AS id
       FROM audit_log a
       JOIN data_points d ON d.id = a.row_id
      WHERE a.rowid > ?
        AND a.table_name = 'data_points'
        AND d.status IN ${CONFIRMED}
        AND NOT EXISTS (
          SELECT 1 FROM audit_log p
           WHERE p.rowid <= ? AND p.table_name = 'data_points' AND p.row_id = d.id
             AND json_extract(p.after_json, '$.status') IN ${CONFIRMED})
        AND (d.supersedes_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM data_points s WHERE s.id = d.supersedes_id AND s.status IN ${CONFIRMED}))
      ORDER BY d.id`,
    mark,
    mark,
  )
  return rows.map((r) => r.id)
}

/** The de-identified dimensions of one confirmed data point: no names, no ids. */
export type CounterDimensions = {
  goalArea: string | null
  proficiencyLevel: Proficiency | null
  label: Label | null
  goalProgress: GoalProgress | null
  period: string
}

/** Goal progress from the PRD 1B decision rule on the objective's confirmed data. */
const PROGRESS_FOR: Record<DecisionOutcome, GoalProgress> = {
  raise_goal: 'above_goal_line',
  keep_collecting: 'near_goal_line',
  change_approach: 'below_goal_line',
  silent: 'insufficient_data',
}

/**
 * Dimensions for the district insights counters (design doc: goal area,
 * proficiency level, adaptation vs. modification, period). The label is
 * "modification" if any active support on the point was a modification,
 * "adaptation" if any was an adaptation, otherwise null. Period is the
 * calendar month of recorded_at.
 */
export function counterDimensions(sql: SqlExecutor, dataPointIds: readonly string[]): CounterDimensions[] {
  return dataPointIds.flatMap((id) => {
    const point = sql.get<{ recorded_at: string; active_adaptations_json: string; objective_id: string; goal_id: string; area: string }>(
      `SELECT d.recorded_at, d.active_adaptations_json, d.objective_id, o.goal_id, g.area
         FROM data_points d
         JOIN objectives o ON o.id = d.objective_id
         JOIN goals g ON g.id = o.goal_id
        WHERE d.id = ?`,
      id,
    )
    if (!point) return []
    const level = sql.get<{ level: Proficiency }>(
      'SELECT level FROM proficiency_ratings WHERE goal_id = ? ORDER BY set_at DESC LIMIT 1',
      point.goal_id,
    )
    const labels = sql
      .all<{ label: Label | null }>(
        'SELECT label FROM suggestions WHERE id IN (SELECT value FROM json_each(?))',
        point.active_adaptations_json,
      )
      .map((r) => r.label)
    const label: Label | null = labels.includes('modification')
      ? 'modification'
      : labels.includes('adaptation')
        ? 'adaptation'
        : null
    const objective = objectiveById(sql, point.objective_id)
    const goalProgress = objective?.status === 'confirmed' ? PROGRESS_FOR[evaluateObjective(sql, objective).outcome] : null
    return [{ goalArea: point.area, proficiencyLevel: level?.level ?? null, label, goalProgress, period: point.recorded_at.slice(0, 7) }]
  })
}

/**
 * Review timeliness for District Insights (PRD "review timeliness"): an IEP
 * confirmed during the op that started at `mark` is on time when it was
 * confirmed by the review date of the IEP version it replaces. The first IEP
 * has nothing to be timely against and yields nothing.
 */
export function reviewTimelinessSince(sql: SqlExecutor, mark: number): { period: string; reviewTimeliness: ReviewTimeliness }[] {
  const confirmed = sql.all<{ version: number; confirmed_at: string }>(
    `SELECT v.version, v.confirmed_at FROM audit_log a JOIN iep_versions v ON v.id = a.row_id
      WHERE a.rowid > ? AND a.action = 'iep_versions.confirm' AND v.confirmed_at IS NOT NULL ORDER BY a.rowid`,
    mark,
  )
  return confirmed.flatMap((c) => {
    const due = sql.get<{ review_date: string | null }>(
      `SELECT json_extract(sections_json, '$.reviewDate') AS review_date FROM iep_versions
        WHERE version < ? AND confirmed_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
      c.version,
    )?.review_date
    if (!due) return []
    return [{ period: c.confirmed_at.slice(0, 7), reviewTimeliness: c.confirmed_at.slice(0, 10) <= due ? 'on_time' : 'late' }]
  })
}

/** Design doc: student mode and audio capture require an active consents row. */
export function hasActiveConsent(sql: SqlExecutor, kind: ConsentKind): boolean {
  return (
    sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM consents WHERE kind = ? AND revoked_at IS NULL', kind)?.n ?? 0
  ) > 0
}

/**
 * What live timeline sockets receive after confirmed data points. Ids only:
 * clients refetch through the scoped API, so each viewer still sees only what
 * its role allows.
 */
export type LiveMessage = { type: 'timeline.updated'; dataPointIds: string[] }

export const liveMessage = (dataPointIds: string[]): LiveMessage => ({ type: 'timeline.updated', dataPointIds })

/**
 * Counter increments for one committed op (without school id and student key,
 * which the room adds): one per newly confirmed data point and one per IEP
 * review confirmed in the op.
 */
export function insightIncrements(sql: SqlExecutor, mark: number, confirmedIds: readonly string[]): Omit<CounterIncrement, 'schoolId' | 'studentKey'>[] {
  const points = counterDimensions(sql, confirmedIds).map((d) => ({ ...d, reviewTimeliness: null, by: 1 }))
  const reviews = reviewTimelinessSince(sql, mark).map((r) => ({
    period: r.period,
    goalArea: null,
    proficiencyLevel: null,
    label: null,
    goalProgress: null,
    reviewTimeliness: r.reviewTimeliness,
    by: 1,
  }))
  return [...points, ...reviews]
}
