import type { SqlExecutor, SqlParam } from '../contract/ops'

/**
 * Row <-> entity mapping shared by all repositories.
 * Convention: entity field fooBar <-> column foo_bar; an object or array field
 * fooBar <-> column foo_bar_json holding JSON text. No boolean columns exist.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/

export const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
export const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/** Single-quoted SQL list for CHECK constraints built from contract enums. */
export const sqlList = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')

/**
 * Entity -> row. Objects and arrays become *_json columns automatically; list a
 * field in jsonFields when its value may be null so it still maps to *_json.
 */
export function toRow(entity: object, jsonFields: readonly string[] = []): Record<string, SqlParam> {
  const row: Record<string, SqlParam> = {}
  for (const [key, value] of Object.entries(entity)) {
    if (value === undefined) continue
    const col = toSnake(key)
    if (jsonFields.includes(key) || (value !== null && typeof value === 'object')) {
      row[`${col}_json`] = value === null ? null : JSON.stringify(value)
    } else if (typeof value === 'boolean') {
      throw new Error(`boolean field "${key}" has no column; store it inside a *_json field`)
    } else {
      row[col] = value as SqlParam
    }
  }
  return row
}

/** Row -> entity (unvalidated; parse the result with the contract schema). */
export function fromRow(row: Record<string, unknown>): Record<string, unknown> {
  const entity: Record<string, unknown> = {}
  for (const [col, value] of Object.entries(row)) {
    if (col.endsWith('_json')) {
      entity[toCamel(col.slice(0, -5))] = value === null ? null : JSON.parse(String(value))
    } else {
      entity[toCamel(col)] = value
    }
  }
  return entity
}

function assertIdent(name: string) {
  if (!IDENT.test(name)) throw new Error(`invalid SQL identifier: ${name}`)
}

/** INSERT a mapped row. Table and column names must be plain identifiers. */
export function insertRow(sql: SqlExecutor, table: string, row: Record<string, SqlParam>): void {
  assertIdent(table)
  const cols = Object.keys(row)
  cols.forEach(assertIdent)
  sql.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ...cols.map((c) => row[c]),
  )
}
