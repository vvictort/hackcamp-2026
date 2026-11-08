import { Goal, IepVersion, Objective } from '../contract/student'
import type { SqlExecutor } from '../contract/ops'
import { findById, parseRow, parseRows } from './base'

type Row = Record<string, unknown>

/** Newest IEP row, confirmed or pending. */
export function latestIep(sql: SqlExecutor): IepVersion | undefined {
  const row = sql.get<Row>('SELECT * FROM iep_versions ORDER BY version DESC LIMIT 1')
  return row ? parseRow(IepVersion, row) : undefined
}

/** The IEP in force: the newest confirmed version. Pending imports never count. */
export function currentIep(sql: SqlExecutor): IepVersion | undefined {
  const row = sql.get<Row>('SELECT * FROM iep_versions WHERE confirmed_at IS NOT NULL ORDER BY version DESC LIMIT 1')
  return row ? parseRow(IepVersion, row) : undefined
}

export function iepByVersion(sql: SqlExecutor, version: number): IepVersion | undefined {
  const row = sql.get<Row>('SELECT * FROM iep_versions WHERE version = ?', version)
  return row ? parseRow(IepVersion, row) : undefined
}

export function goalsForVersion(sql: SqlExecutor, version: number): Goal[] {
  return parseRows(Goal, sql.all<Row>('SELECT * FROM goals WHERE iep_version = ? ORDER BY rowid', version))
}

/** Active goals of the IEP in force. */
export function currentGoals(sql: SqlExecutor): Goal[] {
  const iep = currentIep(sql)
  if (!iep) return []
  return parseRows(
    Goal,
    sql.all<Row>("SELECT * FROM goals WHERE iep_version = ? AND status = 'active' ORDER BY rowid", iep.version),
  )
}

export const goalById = (sql: SqlExecutor, id: string) => findById(sql, 'goals', Goal, id)
export const objectiveById = (sql: SqlExecutor, id: string) => findById(sql, 'objectives', Objective, id)

export function objectivesForGoals(sql: SqlExecutor, goalIds: readonly string[]): Objective[] {
  if (goalIds.length === 0) return []
  return parseRows(
    Objective,
    sql.all<Row>(`SELECT * FROM objectives WHERE goal_id IN (${goalIds.map(() => '?').join(', ')}) ORDER BY rowid`, ...goalIds),
  )
}

/** The goal's confirmed objective (newest confirmation wins). */
export function confirmedObjectiveForGoal(sql: SqlExecutor, goalId: string): Objective | undefined {
  const row = sql.get<Row>(
    "SELECT * FROM objectives WHERE goal_id = ? AND status = 'confirmed' ORDER BY confirmed_at DESC, rowid DESC LIMIT 1",
    goalId,
  )
  return row ? parseRow(Objective, row) : undefined
}

/** Confirmed objectives of the goals in force. */
export function currentConfirmedObjectives(sql: SqlExecutor): Objective[] {
  return currentGoals(sql)
    .map((g) => confirmedObjectiveForGoal(sql, g.id))
    .filter((o): o is Objective => o !== undefined)
}
