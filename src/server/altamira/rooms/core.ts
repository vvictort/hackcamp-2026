import { isAltamiraError } from '../contract/errors'
import { z } from 'zod'
import { defineOp, opErr, opOk, type OpRegistry, type OpResult, type RoomName } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import { appendAudit } from '../db/audit'
import { insertRow, toRow } from '../db/mapping'
import type { SqlExecutor } from '../db/sql'
import { MEMBERSHIPS, PARENT_LINKS, USERS, USER_IDS } from '../fixtures/school'

/**
 * Room core: the part of every Altamira Durable Object that does not need the
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

export const DEV_ROLES = ['case_manager', 'teacher', 'ea', 'parent', 'student', 'district_lead'] as const
export type DevRole = (typeof DEV_ROLES)[number]

/** Fixture user whose access each demo role copies. "student" reuses Kai's parent link (student mode is session based). */
const DEV_ROLE_USER: Record<DevRole, string> = {
  case_manager: USER_IDS.caseManager,
  teacher: USER_IDS.teacher,
  ea: USER_IDS.ea,
  parent: USER_IDS.parentKai,
  student: USER_IDS.parentKai,
  district_lead: USER_IDS.districtLead,
}

const ROLE_TABLE = 'CREATE TABLE IF NOT EXISTS dev_role (user_id TEXT PRIMARY KEY, role TEXT NOT NULL)'

/** The role a caller last switched to, or null when never switched. */
export function devRoleOf(sql: SqlExecutor, userId: string): DevRole | null {
  sql.run(ROLE_TABLE)
  const row = sql.get<{ role: string }>('SELECT role FROM dev_role WHERE user_id = ?', userId)
  return DEV_ROLES.find((r) => r === row?.role) ?? null
}

/**
 * Dev only (the route gates on ALTAMIRA_DEV_SEED). Replaces the caller's
 * memberships and parent_links with copies of the fixture user's rows for the role.
 * Handled by runRoomOp for the school room; not part of the shared registry.
 */
export const devRoleSwitch = defineOp({
  name: 'dev.role',
  room: 'school',
  args: z.object({ role: z.enum(DEV_ROLES).optional() }),
  run(sql, args, actor) {
    const uid = actor.userId
    if (args.role) {
      const source = DEV_ROLE_USER[args.role]
      const at = new Date().toISOString()
      if (!sql.get('SELECT 1 FROM users WHERE id = ?', uid)) {
        const name = USERS.find((u) => u.id === source)?.displayName ?? 'Demo user'
        insertRow(sql, 'users', toRow({ id: uid, displayName: name, createdAt: at }))
      }
      sql.run('DELETE FROM memberships WHERE user_id = ?', uid)
      sql.run('DELETE FROM parent_links WHERE parent_user_id = ?', uid)
      for (const m of MEMBERSHIPS.filter((x) => x.userId === source)) {
        insertRow(sql, 'memberships', toRow({ ...m, id: crypto.randomUUID(), userId: uid, createdAt: at }))
      }
      for (const p of PARENT_LINKS.filter((x) => x.parentUserId === source)) {
        insertRow(sql, 'parent_links', toRow({ ...p, id: crypto.randomUUID(), parentUserId: uid, createdAt: at }))
      }
      sql.run(ROLE_TABLE)
      sql.run('INSERT INTO dev_role (user_id, role) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET role = excluded.role', uid, args.role)
      appendAudit(sql, { actorId: uid, action: 'dev.role', tableName: 'memberships', rowId: uid, after: { role: args.role }, at })
    }
    return { roles: [...DEV_ROLES], active: devRoleOf(sql, uid) }
  },
})

const totalChanges = (sql: SqlExecutor): number =>
  Number(sql.get<{ n: number }>('SELECT total_changes() AS n')?.n ?? 0)

const formatIssues = (error: { issues: { path: PropertyKey[]; message: string }[] }): string =>
  error.issues.map((i) => `${i.path.map(String).join('.') || 'args'}: ${i.message}`).join('; ')

/**
 * Looks the op up, validates args, and runs it inside one transaction.
 * An AltamiraError thrown by the op rolls everything back (audit row included)
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
  const op =
    options.room === 'school' && opName === devRoleSwitch.name
      ? devRoleSwitch
      : Object.hasOwn(registry, opName)
        ? registry[opName]
        : undefined
  if (!op || op.room !== options.room) return opErr('not_found', `Unknown ${options.room} op: ${opName}`)

  let parsedArgs: unknown = args
  if (op.args) {
    const parsed = op.args.safeParse(args)
    if (!parsed.success) return opErr('bad_request', formatIssues(parsed.error))
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
    if (isAltamiraError(e)) return opErr(e.code, e.message)
    if (e instanceof MissingAuditError) throw e
    throw new Error(`room op ${opName} failed`)
  }
}
