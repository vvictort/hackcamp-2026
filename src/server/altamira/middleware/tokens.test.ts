import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateSchool } from '../db/schema/school'
import { seedSchool, STUDENT_IDS, USER_IDS } from '../fixtures'
import { hashToken, issueToken, mintToken, resolveToken } from './tokens'

type Sql = ReturnType<typeof createNodeSqlExecutor>
const NOW = Date.parse('2026-11-07T18:00:00.000Z')

describe('share tokens', () => {
  let sql: Sql
  beforeEach(() => {
    sql = createNodeSqlExecutor()
    migrateSchool(sql)
    seedSchool(sql)
  })
  afterEach(() => sql.close())

  async function issue(expiresAt: string) {
    const { token, tokenHash } = await mintToken()
    const id = issueToken(sql, { kind: 'today_view', studentId: STUDENT_IDS.kai, createdBy: USER_IDS.teacher, tokenHash, expiresAt })
    return { id, token, tokenHash }
  }

  it('stores only the hash and audits the issue without it', async () => {
    const { id, token, tokenHash } = await issue('2026-11-08T06:00:00.000Z')
    expect(tokenHash).toBe(await hashToken(token))
    expect(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM share_tokens WHERE token_hash = ?', token)?.n).toBe(0)
    const audit = sql.get<{ after_json: string }>("SELECT after_json FROM audit_log WHERE table_name = 'share_tokens' AND row_id = ?", id)!
    expect(audit.after_json).not.toContain(tokenHash)
  })

  it('resolves a live token', async () => {
    const { id, tokenHash } = await issue('2026-11-08T06:00:00.000Z')
    expect(resolveToken(sql, tokenHash, 'today_view', NOW)).toMatchObject({ ok: true, token: { id, studentId: STUDENT_IDS.kai } })
  })

  it('answers gone for an expired or revoked token, not_found for unknown or wrong kind', async () => {
    const expired = await issue('2026-11-07T17:59:59.000Z')
    expect(resolveToken(sql, expired.tokenHash, 'today_view', NOW)).toEqual({ ok: false, reason: 'gone' })

    const revoked = await issue('2026-11-08T06:00:00.000Z')
    sql.run('UPDATE share_tokens SET revoked_at = ? WHERE id = ?', '2026-11-07T12:00:00.000Z', revoked.id)
    expect(resolveToken(sql, revoked.tokenHash, 'today_view', NOW)).toEqual({ ok: false, reason: 'gone' })

    expect(resolveToken(sql, await hashToken('nope'), 'today_view', NOW)).toEqual({ ok: false, reason: 'not_found' })
    expect(resolveToken(sql, revoked.tokenHash, 'student_session', NOW)).toEqual({ ok: false, reason: 'not_found' })
  })
})
