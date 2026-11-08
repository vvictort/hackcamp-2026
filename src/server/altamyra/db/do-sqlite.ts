import type { SqlExecutor, SqlParam } from '../contract/ops'

/**
 * SqlExecutor over a Durable Object's ctx.storage. Used by the three
 * Altamyra rooms. transactionSync gives one atomic write per room op; DO
 * SQLite rejects BEGIN/COMMIT, so the adapter never issues them.
 */
export function createDoSqlExecutor(storage: DurableObjectStorage): SqlExecutor {
  const sql = storage.sql
  return {
    all<T>(query: string, ...params: SqlParam[]): T[] {
      return sql.exec(query, ...params).toArray() as T[]
    },
    get<T>(query: string, ...params: SqlParam[]): T | undefined {
      const rows = sql.exec(query, ...params).toArray()
      return rows[0] as T | undefined
    },
    run(query: string, ...params: SqlParam[]) {
      sql.exec(query, ...params).toArray()
      const row = sql.exec<{ n: number }>('SELECT changes() AS n').one()
      return { changes: Number(row.n) }
    },
    transaction<T>(fn: () => T): T {
      return storage.transactionSync(fn)
    },
  }
}
