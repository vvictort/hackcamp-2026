import type { ConsentKind, Label, Proficiency } from '../contract/enums'
import type { SqlExecutor } from '../db/sql'

/** Pure student-room helpers used by AltamiraStudentRoom, testable on node:sqlite. */

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
  period: string
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
    const point = sql.get<{ recorded_at: string; active_adaptations_json: string; goal_id: string; area: string }>(
      `SELECT d.recorded_at, d.active_adaptations_json, o.goal_id, g.area
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
    return [{ goalArea: point.area, proficiencyLevel: level?.level ?? null, label, period: point.recorded_at.slice(0, 7) }]
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
