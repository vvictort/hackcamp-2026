import type { z } from 'zod'
import type { ErrorBody, ErrorCode } from './errors'
import type { Actor, Capability } from './permissions'

/**
 * Execution model (design doc): SQL runs only inside a room. A room op is a
 * synchronous function that the room runs inside one transaction; it must
 * append to audit_log in that same transaction for every write. Throwing
 * (ideally an AltamyraError) rolls everything back.
 */

/** Values that bind the same way in Durable Object SQLite and node:sqlite. */
export type SqlParam = string | number | null

export type SqlRow = Record<string, SqlParam>

/**
 * The one SQL interface Altamyra code is written against. The Durable Object
 * adapter (do-sqlite.ts) wraps ctx.storage.sql; the test adapter
 * (node-sqlite.ts) wraps node:sqlite. Room ops and repositories never import
 * either adapter directly.
 */
export interface SqlExecutor {
  all<T = SqlRow>(sql: string, ...params: SqlParam[]): T[]
  get<T = SqlRow>(sql: string, ...params: SqlParam[]): T | undefined
  run(sql: string, ...params: SqlParam[]): { changes: number }
  /** Runs fn atomically. Nested calls join the outer transaction (savepoints). A throw rolls back. */
  transaction<T>(fn: () => T): T
}

export type RoomName = 'student' | 'school' | 'insights'

export interface RoomOp<A = unknown, R = unknown> {
  name: string
  room: RoomName
  /** Capability the route must have checked with can() before calling this op. */
  capability?: Capability
  /** When set, the room parses args with it before run(). */
  args?: z.ZodType<A>
  run(sql: SqlExecutor, args: A, actor: Actor): R
}

/** Op name -> op. One registry per room kind (services/registry.ts). */
export type OpRegistry = Record<string, RoomOp>

/** Identity helper that keeps an op's argument and result types. */
export const defineOp = <A, R>(op: RoomOp<A, R>): RoomOp<A, R> => op

/**
 * What a room's run(opName, args, actor) RPC returns. Errors cross the
 * Durable Object boundary as data because thrown classes do not survive RPC.
 */
export type OpResult<R = unknown> = { ok: true; value: R } | ({ ok: false } & ErrorBody)

export const opOk = <R>(value: R): OpResult<R> => ({ ok: true, value })
export const opErr = (code: ErrorCode, message: string): OpResult<never> => ({ ok: false, error: { code, message } })

/** The single RPC entry every Altamyra room exposes. */
export interface AltamyraRoomRpc {
  run(opName: string, args: unknown, actor: Actor): Promise<OpResult>
}
