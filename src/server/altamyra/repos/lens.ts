import { Check, Suggestion, type AdaptationSuggestion } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { findById, insertEntity, parseRow } from './base'

type Row = Record<string, unknown>

export const suggestionById = (sql: SqlExecutor, id: string) => findById(sql, 'suggestions', Suggestion, id)

export function insertSuggestion(sql: SqlExecutor, s: Suggestion): void {
  insertEntity(sql, 'suggestions', s, ['goalIds'])
}

export function insertCheck(sql: SqlExecutor, c: Check): void {
  insertEntity(sql, 'checks', c, ['answerKey', 'rubric'])
}

/** The most recent check with an answer key for an objective: the source of an equivalent probe form. */
export function latestKeyedCheck(sql: SqlExecutor, objectiveId: string): Check | undefined {
  const row = sql.get<Row>('SELECT * FROM checks WHERE objective_id = ? AND answer_key_json IS NOT NULL ORDER BY rowid DESC LIMIT 1', objectiveId)
  return row ? parseRow(Check, row) : undefined
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
