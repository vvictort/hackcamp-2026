import type { z } from 'zod'
import { AltamyraError } from '../contract/errors'
import type { Actor } from '../contract/permissions'
import { appendAudit } from '../db/audit'
import { fromRow, insertRow, toRow } from '../db/mapping'
import type { SqlExecutor, SqlParam } from '../db/sql'

/** Generic SQL helpers shared by every repository. Table names are fixed strings in this folder, never user input. */

export const newId = () => crypto.randomUUID()

export const nowIso = (now?: string) => now ?? new Date().toISOString()

export function parseRow<S extends z.ZodType>(schema: S, row: Record<string, unknown>): z.infer<S> {
  return schema.parse(fromRow(row))
}

export function parseRows<S extends z.ZodType>(schema: S, rows: Record<string, unknown>[]): z.infer<S>[] {
  return rows.map((r) => parseRow(schema, r))
}

export function findById<S extends z.ZodType>(sql: SqlExecutor, table: string, schema: S, id: string): z.infer<S> | undefined {
  const row = sql.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, id)
  return row ? parseRow(schema, row) : undefined
}

export function mustFind<S extends z.ZodType>(sql: SqlExecutor, table: string, schema: S, id: string): z.infer<S> {
  const found = findById(sql, table, schema, id)
  if (found === undefined) throw new AltamyraError('not_found', `${table} ${id} not found`)
  return found
}

/** Inserts an entity, mapping fields to columns (objects and arrays to *_json). */
export function insertEntity(sql: SqlExecutor, table: string, entity: object, jsonFields: readonly string[] = []): void {
  insertRow(sql, table, toRow(entity, jsonFields))
}

/** Throws 409 unless the row's current version equals the caller's expectedVersion. */
export function assertVersion(current: number, expected: number, what: string): void {
  if (current !== expected) {
    throw new AltamyraError('version_conflict', `${what} is at version ${current}, expected ${expected}`)
  }
}

/**
 * Optimistic-lock update: SET the given columns and bump the version, only
 * when the stored version equals expectedVersion. Throws 404 or 409.
 */
export function updateVersioned(
  sql: SqlExecutor,
  table: string,
  id: string,
  expectedVersion: number,
  set: Record<string, SqlParam>,
  versionColumn = 'version',
): void {
  const cols = Object.keys(set)
  const assignments = [...cols.map((c) => `${c} = ?`), `${versionColumn} = ${versionColumn} + 1`].join(', ')
  const { changes } = sql.run(
    `UPDATE ${table} SET ${assignments} WHERE id = ? AND ${versionColumn} = ?`,
    ...cols.map((c) => set[c]),
    id,
    expectedVersion,
  )
  if (changes === 1) return
  const row = sql.get<{ v: number }>(`SELECT ${versionColumn} AS v FROM ${table} WHERE id = ?`, id)
  if (!row) throw new AltamyraError('not_found', `${table} ${id} not found`)
  throw new AltamyraError('version_conflict', `${table} ${id} is at version ${row.v}, expected ${expectedVersion}`)
}

/** Appends the audit row for a write, in the caller's transaction. */
export function audit(
  sql: SqlExecutor,
  actor: Actor,
  action: string,
  tableName: string,
  rowId: string,
  before?: unknown,
  after?: unknown,
  at?: string,
): void {
  appendAudit(sql, { actorId: actor.userId, action, tableName, rowId, before, after, at })
}

/** JSON text for a *_json column. */
export const json = (value: unknown): string => JSON.stringify(value)
