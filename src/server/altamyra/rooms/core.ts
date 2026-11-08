import { isAltamyraError } from '../contract/errors'
import { issuesOf } from '../contract/issues'
import { opErr, opOk, type OpRegistry, type OpResult, type RoomName } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import type { SqlExecutor } from '../db/sql'

/**
 * Room core: the part of every Altamyra Durable Object that does not need the
 * Workers runtime, so it runs the same on node:sqlite in Vitest.
 */

export type RunOptions = {
  /** Which registry the op must belong to. */
  room: RoomName
  /**
   * Refuse any op that changed rows without appending to audit_log in the same
   * transaction (design doc "Request flow"; NFR Security: append-only audit log).
   * Off for the insights room, which holds only de-identified counters.
   */
  requireAudit: boolean
}

/** Thrown (and rolled back) when an op writes without an audit row. */
export class MissingAuditError extends Error {
  constructor(opName: string) {
    super(`room op ${opName} wrote rows without an audit_log entry`)
    this.name = 'MissingAuditError'
  }
}

/** The highest audit_log rowid so far; rows appended later have a larger rowid. */
export function auditMark(sql: SqlExecutor): number {
  return sql.get<{ m: number | null }>('SELECT MAX(rowid) AS m FROM audit_log')?.m ?? 0
}

const totalChanges = (sql: SqlExecutor): number =>
  Number(sql.get<{ n: number }>('SELECT total_changes() AS n')?.n ?? 0)

/**
 * Looks the op up, validates args, and runs it inside one transaction.
 * An AltamyraError thrown by the op rolls everything back (audit row included)
 * and comes back as data, since thrown classes do not survive Durable Object RPC.
 * Any other error also rolls back and is rethrown without its details, so SQL
 * values never reach the logs.
 */
export function runRoomOp(
  sql: SqlExecutor,
  registry: OpRegistry,
  opName: string,
  args: unknown,
  actor: Actor,
  options: RunOptions,
): OpResult {
  const op = Object.hasOwn(registry, opName) ? registry[opName] : undefined
  if (!op || op.room !== options.room) return opErr('not_found', `Unknown ${options.room} op: ${opName}`)

  let parsedArgs: unknown = args
  if (op.args) {
    const parsed = op.args.safeParse(args)
    if (!parsed.success) return opErr('bad_request', issuesOf(parsed.error, 'args').join('; '))
    parsedArgs = parsed.data
  }

  try {
    const value = sql.transaction(() => {
      const mark = options.requireAudit ? auditMark(sql) : 0
      const changesBefore = options.requireAudit ? totalChanges(sql) : 0
      const result = op.run(sql, parsedArgs, actor)
      if (options.requireAudit && totalChanges(sql) > changesBefore && auditMark(sql) === mark) {
        throw new MissingAuditError(opName)
      }
      return result
    })
    return opOk(value)
  } catch (e) {
    if (isAltamyraError(e)) return opErr(e.code, e.message)
    if (e instanceof MissingAuditError) throw e
    throw new Error(`room op ${opName} failed`)
  }
}
