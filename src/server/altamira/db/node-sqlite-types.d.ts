// Minimal types for Node's built-in node:sqlite (the repo has no @types/node).
// Used only by the test adapter in node-sqlite.ts.
declare module 'node:sqlite' {
  type Value = string | number | bigint | null | Uint8Array

  export class StatementSync {
    all(...params: Value[]): Record<string, unknown>[]
    get(...params: Value[]): Record<string, unknown> | undefined
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; enableForeignKeyConstraints?: boolean })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
