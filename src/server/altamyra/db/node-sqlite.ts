import { DatabaseSync } from 'node:sqlite'
import type { SqlExecutor, SqlParam } from '../contract/ops'

/**
 * SqlExecutor over node:sqlite, for Vitest only (never imported by Worker
 * code). Outer transactions use BEGIN/COMMIT/ROLLBACK; nested ones use
 * savepoints, matching how ctx.storage.transactionSync nests.
 */
export function createNodeSqlExecutor(path = ':memory:'): SqlExecutor & { close(): void } {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true })
  let depth = 0

  const plain = <T>(row: Record<string, unknown>): T => ({ ...row }) as T

  return {
    all<T>(sql: string, ...params: SqlParam[]): T[] {
      return db.prepare(sql).all(...params).map((r) => plain<T>(r))
    },
    get<T>(sql: string, ...params: SqlParam[]): T | undefined {
      const row = db.prepare(sql).get(...params)
      return row ? plain<T>(row) : undefined
    },
    run(sql: string, ...params: SqlParam[]) {
      return { changes: Number(db.prepare(sql).run(...params).changes) }
    },
    transaction<T>(fn: () => T): T {
      const savepoint = `sp_${depth}`
      db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
      depth++
      try {
        const result = fn()
        if (result instanceof Promise) throw new Error('transaction callbacks must be synchronous')
        depth--
        db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
        return result
      } catch (e) {
        depth--
        db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
        throw e
      }
    },
    close() {
      db.close()
    },
  }
}
