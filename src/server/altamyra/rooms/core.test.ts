import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AltamyraError } from '../contract/errors'
import { defineOp, type OpRegistry } from '../contract/ops'
import { userActor } from '../contract/permissions'
import { appendAudit } from '../db/audit'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateSchool } from '../db/schema/school'
import { USER_IDS } from '../fixtures/school'
import { auditMark, MissingAuditError, runRoomOp } from './core'

type Sql = ReturnType<typeof createNodeSqlExecutor>
const actor = userActor(USER_IDS.schoolAdmin)
const school = { room: 'school', requireAudit: true } as const

const insertUser = (sql: Sql, id: string) =>
  sql.run('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)', id, 'Fictional Person', '2026-09-01T00:00:00.000Z')

const ops: OpRegistry = {
  'user.add': defineOp({
    name: 'user.add',
    room: 'school',
    args: z.object({ id: z.string().min(1) }),
    run(sql, args, a) {
      insertUser(sql as Sql, args.id)
      appendAudit(sql, { actorId: a.userId, action: 'user.add', tableName: 'users', rowId: args.id })
      return { id: args.id }
    },
  }),
  'user.addThenRefuse': defineOp({
    name: 'user.addThenRefuse',
    room: 'school',
    run(sql, _args, a) {
      insertUser(sql as Sql, 'refused')
      appendAudit(sql, { actorId: a.userId, action: 'user.add', tableName: 'users', rowId: 'refused' })
      throw new AltamyraError('version_conflict', 'stale version')
    },
  }),
  'user.addThenCrash': defineOp({
    name: 'user.addThenCrash',
    room: 'school',
    run(sql, _args, a) {
      insertUser(sql as Sql, 'crashed')
      appendAudit(sql, { actorId: a.userId, action: 'user.add', tableName: 'users', rowId: 'crashed' })
      throw new Error('constraint failed: value Leila')
    },
  }),
  'user.addNoAudit': defineOp({
    name: 'user.addNoAudit',
    room: 'school',
    run(sql) {
      insertUser(sql as Sql, 'unaudited')
      return null
    },
  }),
  'user.count': defineOp({
    name: 'user.count',
    room: 'school',
    run: (sql) => sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0,
  }),
}

const count = (sql: Sql, table: string) => sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0

describe('runRoomOp', () => {
  let sql: Sql
  beforeEach(() => {
    sql = createNodeSqlExecutor()
    migrateSchool(sql)
  })
  afterEach(() => sql.close())

  it('dispatches by name and returns the value', () => {
    expect(runRoomOp(sql, ops, 'user.add', { id: 'u1' }, actor, school)).toEqual({ ok: true, value: { id: 'u1' } })
    expect(runRoomOp(sql, ops, 'user.count', {}, actor, school)).toEqual({ ok: true, value: 1 })
  })

  it('answers not_found for an unknown op or an inherited key', () => {
    for (const name of ['nope', 'toString']) {
      const r = runRoomOp(sql, ops, name, {}, actor, school)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('not_found')
    }
  })

  it('answers bad_request when args fail the op schema, and runs nothing', () => {
    const r = runRoomOp(sql, ops, 'user.add', { id: '' }, actor, school)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('bad_request')
    expect(count(sql, 'users')).toBe(0)
  })

  it('writes the row and its audit row in the same transaction', () => {
    const mark = auditMark(sql)
    runRoomOp(sql, ops, 'user.add', { id: 'u2' }, actor, school)
    const audit = sql.all<{ row_id: string; actor_id: string }>('SELECT row_id, actor_id FROM audit_log WHERE rowid > ?', mark)
    expect(audit).toEqual([{ row_id: 'u2', actor_id: actor.userId }])
    expect(count(sql, 'users')).toBe(1)
  })

  it('rolls back the row and the audit row when the op throws an AltamyraError, and returns it as data', () => {
    const r = runRoomOp(sql, ops, 'user.addThenRefuse', {}, actor, school)
    expect(r).toEqual({ ok: false, error: { code: 'version_conflict', message: 'stale version' } })
    expect(count(sql, 'users')).toBe(0)
    expect(count(sql, 'audit_log')).toBe(0)
  })

  it('rolls back on any other error and rethrows without the original details', () => {
    expect(() => runRoomOp(sql, ops, 'user.addThenCrash', {}, actor, school)).toThrow('room op user.addThenCrash failed')
    try {
      runRoomOp(sql, ops, 'user.addThenCrash', {}, actor, school)
    } catch (e) {
      expect(String(e)).not.toContain('Leila')
    }
    expect(count(sql, 'users')).toBe(0)
    expect(count(sql, 'audit_log')).toBe(0)
  })

  it('refuses and rolls back a write that appended no audit row', () => {
    expect(() => runRoomOp(sql, ops, 'user.addNoAudit', {}, actor, school)).toThrow(MissingAuditError)
    expect(count(sql, 'users')).toBe(0)
  })

  it('allows a write without audit when the room does not require it', () => {
    const r = runRoomOp(sql, ops, 'user.addNoAudit', {}, actor, { room: 'school', requireAudit: false })
    expect(r.ok).toBe(true)
    expect(count(sql, 'users')).toBe(1)
  })
})
