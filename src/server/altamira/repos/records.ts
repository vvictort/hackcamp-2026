import type { ConsentKind } from '../contract/enums'
import {
  Consent,
  FamilySummary,
  Handoff,
  ParentInput,
  Probe,
  ProficiencyRating,
  ProgressDraft,
  Proposal,
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

// ---------- proposals and parent input ----------

export const proposalById = (sql: SqlExecutor, id: string) => findById(sql, 'proposals', Proposal, id)

export function listProposals(sql: SqlExecutor, status?: Proposal['status']): Proposal[] {
  return parseRows(
    Proposal,
    status
      ? sql.all<Row>('SELECT * FROM proposals WHERE status = ? ORDER BY created_at, rowid', status)
      : sql.all<Row>('SELECT * FROM proposals ORDER BY created_at, rowid'),
  )
}

export function listParentInputs(sql: SqlExecutor): ParentInput[] {
  return parseRows(ParentInput, sql.all<Row>('SELECT * FROM parent_inputs ORDER BY created_at, rowid'))
}

// ---------- proficiency ----------

export function latestProficiency(sql: SqlExecutor, goalId: string): ProficiencyRating | undefined {
  const row = sql.get<Row>(
    'SELECT * FROM proficiency_ratings WHERE goal_id = ? ORDER BY set_at DESC, rowid DESC LIMIT 1',
    goalId,
  )
  return row ? parseRow(ProficiencyRating, row) : undefined
}

// ---------- drafts, summaries, handoffs ----------

export const draftById = (sql: SqlExecutor, id: string) => findById(sql, 'progress_drafts', ProgressDraft, id)
export const summaryById = (sql: SqlExecutor, id: string) => findById(sql, 'family_summaries', FamilySummary, id)
export const handoffById = (sql: SqlExecutor, id: string) => findById(sql, 'handoffs', Handoff, id)

export function approvedSummaries(sql: SqlExecutor): FamilySummary[] {
  return parseRows(
    FamilySummary,
    sql.all<Row>("SELECT * FROM family_summaries WHERE status = 'approved' ORDER BY approved_at, rowid"),
  )
}

export function draftCitationIds(sql: SqlExecutor, draftId: string): string[] {
  return sql
    .all<{ data_point_id: string }>('SELECT data_point_id FROM draft_citations WHERE draft_id = ? ORDER BY sentence_index, rowid', draftId)
    .map((r) => r.data_point_id)
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
