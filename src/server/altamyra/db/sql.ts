/**
 * The one SQL interface Altamyra code is written against. The Durable Object
 * adapter (do-sqlite.ts) wraps ctx.storage.sql; the test adapter
 * (node-sqlite.ts) wraps node:sqlite. Room ops and repositories never import
 * either adapter directly.
 */

/** Values that bind the same way in Durable Object SQLite and node:sqlite. */
export type SqlParam = string | number | null

export type SqlRow = Record<string, SqlParam>

export interface SqlExecutor {
  all<T = SqlRow>(sql: string, ...params: SqlParam[]): T[]
  get<T = SqlRow>(sql: string, ...params: SqlParam[]): T | undefined
  run(sql: string, ...params: SqlParam[]): { changes: number }
  /** Runs fn atomically. Nested calls join the outer transaction (savepoints). A throw rolls back. */
  transaction<T>(fn: () => T): T
}
