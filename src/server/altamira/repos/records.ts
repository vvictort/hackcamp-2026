import type { ConsentKind } from '../contract/enums'
import {
  Consent,
  FamilySummary,
  Probe,
  ProficiencyRating,
} from '../contract/student'
import type { SqlExecutor } from '../db/sql'
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

// ---------- family summaries ----------

export const summaryById = (sql: SqlExecutor, id: string) => findById(sql, 'family_summaries', FamilySummary, id)

export function listSummaries(sql: SqlExecutor): FamilySummary[] {
  return parseRows(FamilySummary, sql.all<Row>('SELECT * FROM family_summaries ORDER BY created_at, rowid'))
}

export function approvedSummaries(sql: SqlExecutor): FamilySummary[] {
  return parseRows(
    FamilySummary,
    sql.all<Row>("SELECT * FROM family_summaries WHERE status = 'approved' ORDER BY approved_at, rowid"),
  )
}

// ---------- probes ----------

export function probesForObjectives(sql: SqlExecutor, objectiveIds: readonly string[]): Probe[] {
  if (objectiveIds.length === 0) return []
  return parseRows(
    Probe,
    sql.all<Row>(
      `SELECT * FROM probes WHERE objective_id IN (${objectiveIds.map(() => '?').join(', ')}) ORDER BY rowid`,
      ...objectiveIds,
    ),
  )
}
