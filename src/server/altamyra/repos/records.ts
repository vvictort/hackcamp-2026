import type { ConsentKind, SummaryKind } from '../contract/enums'
import { Consent, DayReview, Note, ProficiencyRating, Summary, Video } from '../contract/student'
import type { SqlExecutor } from '../contract/ops'
import { findById, parseRow, parseRows } from './base'

type Row = Record<string, unknown>

// ---------- consents ----------

/** Active consent of a kind: granted and not revoked (PRD NFR Consent). */
export function activeConsent(sql: SqlExecutor, kind: ConsentKind): Consent | undefined {
  const row = sql.get<Row>(
    'SELECT * FROM consents WHERE kind = ? AND revoked_at IS NULL ORDER BY granted_at DESC, rowid DESC LIMIT 1',
    kind,
  )
  return row ? parseRow(Consent, row) : undefined
}

export function listConsents(sql: SqlExecutor): Consent[] {
  return parseRows(Consent, sql.all<Row>('SELECT * FROM consents ORDER BY granted_at, rowid'))
}

// ---------- proficiency ----------

export function latestProficiency(sql: SqlExecutor, goalId: string): ProficiencyRating | undefined {
  const row = sql.get<Row>(
    'SELECT * FROM proficiency_ratings WHERE goal_id = ? ORDER BY set_at DESC, rowid DESC LIMIT 1',
    goalId,
  )
  return row ? parseRow(ProficiencyRating, row) : undefined
}

// ---------- summaries (daily, weekly, monthly) ----------

export const summaryById = (sql: SqlExecutor, id: string) => findById(sql, 'summaries', Summary, id)

export function summaryFor(sql: SqlExecutor, kind: SummaryKind, period: string): Summary | undefined {
  const row = sql.get<Row>('SELECT * FROM summaries WHERE kind = ? AND period = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', kind, period)
  return row ? parseRow(Summary, row) : undefined
}

/** Newest period first. */
export function listSummaries(sql: SqlExecutor, q: { kind?: SummaryKind; status?: Summary['status'] } = {}): Summary[] {
  const where = ['1 = 1']
  const params: string[] = []
  if (q.kind) {
    where.push('kind = ?')
    params.push(q.kind)
  }
  if (q.status) {
    where.push('status = ?')
    params.push(q.status)
  }
  return parseRows(Summary, sql.all<Row>(`SELECT * FROM summaries WHERE ${where.join(' AND ')} ORDER BY period DESC, rowid DESC`, ...params))
}

// ---------- notes, videos, day reviews ----------

export const notesBetween = (sql: SqlExecutor, from: string, to: string): Note[] =>
  parseRows(Note, sql.all<Row>('SELECT * FROM notes WHERE recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at, rowid', from, to))

export const videosBetween = (sql: SqlExecutor, from: string, to: string): Video[] =>
  parseRows(Video, sql.all<Row>('SELECT * FROM videos WHERE recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at, rowid', from, to))

export function dayReviewOf(sql: SqlExecutor, date: string): DayReview | undefined {
  const row = sql.get<Row>('SELECT * FROM day_reviews WHERE date = ?', date)
  return row ? parseRow(DayReview, row) : undefined
}

export const dayReviewsBetween = (sql: SqlExecutor, fromDate: string, toDate: string): DayReview[] =>
  parseRows(DayReview, sql.all<Row>('SELECT * FROM day_reviews WHERE date >= ? AND date <= ? ORDER BY date', fromDate, toDate))
