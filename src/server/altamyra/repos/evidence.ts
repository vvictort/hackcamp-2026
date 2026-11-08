import { FAMILY_VISIBLE_STATUSES } from '../contract/enums'
import { DataPoint, Decision, ReviewItem } from '../contract/student'
import { sqlList } from '../db/mapping'
import type { SqlExecutor, SqlParam } from '../db/sql'
import type { Point } from '../services/analytics'
import { findById, insertEntity, parseRow, parseRows } from './base'

type Row = Record<string, unknown>

/** A data point is current unless a correction supersedes it (corrections are new rows). */
const HEAD = 'NOT EXISTS (SELECT 1 FROM data_points n WHERE n.supersedes_id = d.id)'

/** PRD "Parents see only confirmed data": pending values never leave the repository for family views. */
const FAMILY_ONLY = `d.status IN (${sqlList(FAMILY_VISIBLE_STATUSES)})`

export type DataPointQuery = {
  objectiveId?: string
  objectiveIds?: readonly string[]
  from?: string
  to?: string
  /** Confirmed and auto-confirmed only (family views, analytics, citations). */
  confirmedOnly?: boolean
  sourceRefPrefix?: string
}

/** Current (non-superseded) data points, oldest first. */
export function headDataPoints(sql: SqlExecutor, q: DataPointQuery = {}): DataPoint[] {
  const where = [HEAD]
  const params: SqlParam[] = []
  if (q.objectiveId) {
    where.push('d.objective_id = ?')
    params.push(q.objectiveId)
  }
  if (q.objectiveIds) {
    if (q.objectiveIds.length === 0) return []
    where.push(`d.objective_id IN (${q.objectiveIds.map(() => '?').join(', ')})`)
    params.push(...q.objectiveIds)
  }
  if (q.from) {
    where.push('d.recorded_at >= ?')
    params.push(q.from)
  }
  if (q.to) {
    where.push('d.recorded_at <= ?')
    params.push(q.to)
  }
  if (q.confirmedOnly) where.push(FAMILY_ONLY)
  if (q.sourceRefPrefix) {
    where.push("substr(d.source_ref, 1, length(?)) = ?")
    params.push(q.sourceRefPrefix, q.sourceRefPrefix)
  }
  return parseRows(
    DataPoint,
    sql.all<Row>(`SELECT d.* FROM data_points d WHERE ${where.join(' AND ')} ORDER BY d.recorded_at, d.rowid`, ...params),
  )
}

/** Family-facing read: confirmed and auto-confirmed only, filtered in SQL. */
export const familyDataPoints = (sql: SqlExecutor, objectiveIds: readonly string[]) =>
  headDataPoints(sql, { objectiveIds, confirmedOnly: true })

export const toPoints = (points: readonly DataPoint[]): Point[] =>
  points.map((p) => ({ at: p.recordedAt, value: p.value, source: p.source }))

/** Confirmed analytics input for one objective. */
export const confirmedPoints = (sql: SqlExecutor, objectiveId: string): Point[] =>
  toPoints(headDataPoints(sql, { objectiveId, confirmedOnly: true }))

export const dataPointById = (sql: SqlExecutor, id: string) => findById(sql, 'data_points', DataPoint, id)

export function isHead(sql: SqlExecutor, id: string): boolean {
  return !sql.get('SELECT 1 AS x FROM data_points WHERE supersedes_id = ?', id)
}

export function insertDataPoint(sql: SqlExecutor, dp: DataPoint): void {
  insertEntity(sql, 'data_points', dp, ['activeAdaptations', 'sessionDetail'])
}

export const reviewById = (sql: SqlExecutor, id: string) => findById(sql, 'review_queue', ReviewItem, id)

export function openReviewItems(sql: SqlExecutor): ReviewItem[] {
  return parseRows(ReviewItem, sql.all<Row>("SELECT * FROM review_queue WHERE status = 'open' ORDER BY created_at, rowid"))
}

export function openReviewForDataPoint(sql: SqlExecutor, dataPointId: string): ReviewItem[] {
  return parseRows(
    ReviewItem,
    sql.all<Row>("SELECT * FROM review_queue WHERE data_point_id = ? AND status = 'open'", dataPointId),
  )
}

export function decisions(sql: SqlExecutor, q: { objectiveIds?: readonly string[]; since?: string } = {}): Decision[] {
  const where: string[] = ['1 = 1']
  const params: SqlParam[] = []
  if (q.objectiveIds) {
    if (q.objectiveIds.length === 0) return []
    where.push(`objective_id IN (${q.objectiveIds.map(() => '?').join(', ')})`)
    params.push(...q.objectiveIds)
  }
  if (q.since) {
    where.push('fired_at >= ?')
    params.push(q.since)
  }
  return parseRows(Decision, sql.all<Row>(`SELECT * FROM decisions WHERE ${where.join(' AND ')} ORDER BY fired_at, rowid`, ...params))
}

export function latestDecision(sql: SqlExecutor, objectiveId: string): Decision | undefined {
  const row = sql.get<Row>('SELECT * FROM decisions WHERE objective_id = ? ORDER BY fired_at DESC, rowid DESC LIMIT 1', objectiveId)
  return row ? parseRow(Decision, row) : undefined
}
