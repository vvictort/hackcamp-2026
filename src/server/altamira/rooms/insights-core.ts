import { CounterIncrement } from '../contract/insights'
import type { SqlExecutor } from '../db/sql'
import { applyIncrement } from '../services/insights'

/**
 * Adds increments to the district's de-identified counters, one row per
 * student key and dimension combination (db/schema/insights.ts). Runs in one
 * transaction. Increments are parsed first, so nothing but the contract's
 * de-identified fields can be stored.
 */
export function applyCounterIncrements(sql: SqlExecutor, districtId: string, increments: unknown[]): number {
  const parsed = increments.map((i) => CounterIncrement.parse(i))
  return sql.transaction(() => {
    for (const inc of parsed) applyIncrement(sql, districtId, inc)
    return parsed.length
  })
}
