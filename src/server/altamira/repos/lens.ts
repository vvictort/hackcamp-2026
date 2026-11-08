import { Check, LensRun, Suggestion, type AdaptationSuggestion } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { findById, insertEntity, parseRow, parseRows } from './base'

type Row = Record<string, unknown>

export const suggestionById = (sql: SqlExecutor, id: string) => findById(sql, 'suggestions', Suggestion, id)
export const checkById = (sql: SqlExecutor, id: string) => findById(sql, 'checks', Check, id)

export function insertSuggestion(sql: SqlExecutor, s: Suggestion): void {
  insertEntity(sql, 'suggestions', s, ['goalIds'])
}

export function insertCheck(sql: SqlExecutor, c: Check): void {
  insertEntity(sql, 'checks', c, ['answerKey', 'rubric'])
}

export function latestLensRun(sql: SqlExecutor, lessonId: string): LensRun | undefined {
  const row = sql.get<Row>('SELECT * FROM lens_runs WHERE lesson_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', lessonId)
  return row ? parseRow(LensRun, row) : undefined
}

export function suggestionsForRun(sql: SqlExecutor, lensRunId: string): Suggestion[] {
  return parseRows(Suggestion, sql.all<Row>('SELECT * FROM suggestions WHERE lens_run_id = ? ORDER BY rowid', lensRunId))
}

export function checksForSuggestions(sql: SqlExecutor, suggestionIds: readonly string[], activeOnly = true): Check[] {
  if (suggestionIds.length === 0) return []
  const status = activeOnly ? " AND status = 'active'" : ''
  return parseRows(
    Check,
    sql.all<Row>(
      `SELECT * FROM checks WHERE suggestion_id IN (${suggestionIds.map(() => '?').join(', ')})${status} ORDER BY rowid`,
      ...suggestionIds,
    ),
  )
}

/** Approved adaptations, optionally limited to one lesson's lens runs. */
export function approvedAdaptations(sql: SqlExecutor, lessonId?: string): (AdaptationSuggestion & { lessonId: string })[] {
  const rows = sql.all<Row>(
    `SELECT s.*, r.lesson_id AS run_lesson_id FROM suggestions s JOIN lens_runs r ON r.id = s.lens_run_id
     WHERE s.kind = 'adaptation' AND s.status = 'approved'${lessonId ? ' AND r.lesson_id = ?' : ''}
     ORDER BY s.rowid`,
    ...(lessonId ? [lessonId] : []),
  )
  return rows.map((row) => {
    const { run_lesson_id: runLessonId, ...rest } = row
    const s = parseRow(Suggestion, rest) as AdaptationSuggestion
    return { ...s, lessonId: String(runLessonId) }
  })
}

/** Active checks attached to approved adaptations: the items student mode may deliver. */
export function approvedChecks(sql: SqlExecutor): Check[] {
  return parseRows(
    Check,
    sql.all<Row>(
      `SELECT c.* FROM checks c JOIN suggestions s ON s.id = c.suggestion_id
       WHERE c.status = 'active' AND s.status = 'approved' ORDER BY c.rowid`,
    ),
  )
}
