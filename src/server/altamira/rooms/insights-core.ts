import { CounterIncrement } from '../contract/insights'
import type { SqlExecutor } from '../db/sql'

/**
 * Adds increments to the district's de-identified counters, one row per
 * student key and dimension combination (db/schema/insights.ts). Runs in one
 * transaction. Increments are parsed first, so nothing but the contract's
 * de-identified fields can be stored.
 */
export function applyCounterIncrements(sql: SqlExecutor, districtId: string, increments: unknown[]): number {
  const parsed = increments.map((i) => CounterIncrement.parse(i))
  return sql.transaction(() => {
    for (const inc of parsed) {
      const existing = sql.get<{ id: string }>(
        `SELECT id FROM counters
          WHERE district_id = ? AND school_id = ? AND period = ? AND student_key = ?
            AND IFNULL(goal_area, '') = ? AND IFNULL(proficiency_level, '') = ?
            AND IFNULL(label, '') = ? AND IFNULL(review_timeliness, '') = ?`,
        districtId,
        inc.schoolId,
        inc.period,
        inc.studentKey,
        inc.goalArea ?? '',
        inc.proficiencyLevel ?? '',
        inc.label ?? '',
        inc.reviewTimeliness ?? '',
      )
      if (existing) {
        sql.run('UPDATE counters SET count = count + ?, version = version + 1 WHERE id = ?', inc.by, existing.id)
      } else {
        sql.run(
          `INSERT INTO counters (id, district_id, school_id, period, student_key, goal_area, proficiency_level, label, review_timeliness, count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
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
    }
    return parsed.length
  })
}
