import type { SqlExecutor } from './sql'

/** One migration = a list of single SQL statements (no statement splitting is done). */
export type Migration = readonly string[]

const VERSION_TABLE =
  'CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'

export function schemaVersion(sql: SqlExecutor): number {
  sql.run(VERSION_TABLE)
  return sql.get<{ version: number }>('SELECT version FROM schema_version WHERE id = 1')?.version ?? 0
}

/**
 * Applies every migration after the stored version, all in one transaction.
 * Safe to call on every room start. Returns the resulting version.
 */
export function runMigrations(sql: SqlExecutor, migrations: readonly Migration[]): number {
  const current = schemaVersion(sql)
  if (current >= migrations.length) return current
  return sql.transaction(() => {
    for (let v = current; v < migrations.length; v++) {
      for (const statement of migrations[v]) sql.run(statement)
    }
    sql.run(
      'INSERT INTO schema_version (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version',
      migrations.length,
    )
    return migrations.length
  })
}

/** Triggers that make a table append-only (NFR Security: "append-only audit log"). */
export function appendOnlyTriggers(table: string): string[] {
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END`,
  ]
}

/** audit_log DDL shared by the student and school rooms. */
export const AUDIT_LOG_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS audit_log_row ON audit_log (table_name, row_id)',
  ...appendOnlyTriggers('audit_log'),
]
