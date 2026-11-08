import type { ShareTokenKind } from '../contract/enums'
import { appendAudit } from '../db/audit'
import type { SqlExecutor } from '../db/sql'

/**
 * Share tokens for Today View links and student-mode sessions. Only the
 * SHA-256 hash of a token is stored; the raw token lives in the link or on the
 * student device. Hashing is async (crypto.subtle), so it happens outside the
 * room transaction and the room receives only the hash.
 */

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

export const hashToken = sha256Hex

/** A new random token (32 bytes, hex) and its hash. */
export async function mintToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = toHex(bytes.buffer)
  return { token, tokenHash: await hashToken(token) }
}

export type IssueTokenInput = {
  kind: ShareTokenKind
  studentId: string
  createdBy: string
  tokenHash: string
  expiresAt: string
  /** Defaults to now. */
  createdAt?: string
}

/** Inserts a share_tokens row and its audit row in one transaction. Returns the token id. */
export function issueToken(sql: SqlExecutor, input: IssueTokenInput): string {
  const id = crypto.randomUUID()
  const createdAt = input.createdAt ?? new Date().toISOString()
  sql.transaction(() => {
    sql.run(
      'INSERT INTO share_tokens (id, token_hash, kind, student_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.tokenHash,
      input.kind,
      input.studentId,
      input.createdBy,
      createdAt,
      input.expiresAt,
    )
    appendAudit(sql, {
      actorId: input.createdBy,
      action: `share_token.issue.${input.kind}`,
      tableName: 'share_tokens',
      rowId: id,
      // The hash is never copied into the audit log.
      after: { kind: input.kind, studentId: input.studentId, expiresAt: input.expiresAt },
      at: createdAt,
    })
  })
  return id
}

export type ResolvedToken = {
  id: string
  kind: ShareTokenKind
  studentId: string
  createdBy: string
  expiresAt: string
}

export type TokenLookup = { ok: true; token: ResolvedToken } | { ok: false; reason: 'not_found' | 'gone' }

/** Design doc: expired or revoked share tokens return 410. Unknown tokens are 404. */
export function resolveToken(sql: SqlExecutor, tokenHash: string, kind: ShareTokenKind, now: number): TokenLookup {
  const row = sql.get<{
    id: string
    kind: ShareTokenKind
    student_id: string
    created_by: string
    expires_at: string
    revoked_at: string | null
  }>(
    'SELECT id, kind, student_id, created_by, expires_at, revoked_at FROM share_tokens WHERE token_hash = ? AND kind = ?',
    tokenHash,
    kind,
  )
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.revoked_at !== null || Date.parse(row.expires_at) <= now) return { ok: false, reason: 'gone' }
  return {
    ok: true,
    token: { id: row.id, kind: row.kind, studentId: row.student_id, createdBy: row.created_by, expiresAt: row.expires_at },
  }
}
