import type { SqlExecutor } from './sql'

export type AuditInput = {
  actorId: string
  action: string
  tableName: string
  rowId: string
  before?: unknown
  after?: unknown
  /** Defaults to now. */
  at?: string
  /** Defaults to a random UUID. */
  id?: string
}

/**
 * Appends one audit_log row. Call it inside the same transaction as the write
 * it describes, so both land or neither does (design doc "Request flow").
 */
export function appendAudit(sql: SqlExecutor, entry: AuditInput): string {
  const id = entry.id ?? crypto.randomUUID()
  sql.run(
    'INSERT INTO audit_log (id, at, actor_id, action, table_name, row_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    entry.at ?? new Date().toISOString(),
    entry.actorId,
    entry.action,
    entry.tableName,
    entry.rowId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  )
  return id
}
