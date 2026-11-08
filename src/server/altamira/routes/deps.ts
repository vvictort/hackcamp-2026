import type { ErrorHandler } from 'hono'
import type { Env } from '../../../../worker'
import type { AiProvider } from '../contract/ai'
import type { MediaRef } from '../contract/common'
import type { Roster } from '../ai/deidentify'
import type { AltamiraEnv } from '../middleware/auth'
import type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from '../rooms/rpc'

/**
 * Everything the /api/v1 routes reach outside themselves. Production values
 * live in routes/defaults.ts; tests pass in-memory rooms on node:sqlite.
 */
export type AltamiraRouteDeps = {
  rooms: {
    student(env: Env, studentId: string): StudentRoomRpc
    school(env: Env): SchoolRoomRpc
    insights(env: Env): InsightsRoomRpc
  }
  /** The DeepSpace userId for the request, or null when not signed in. */
  resolveUserId(req: Request, env: Env): Promise<string | null>
  /** AI provider (env ALTAMIRA_AI_PROVIDER; fixture by default). */
  aiProvider(env: Env): AiProvider
  /** Names and identifiers the AI module must strip before any call. */
  roster(env: Env): Roster | Promise<Roster>
  /** The single school and district this deployment serves. */
  schoolId(env: Env): string
  districtId(env: Env): string
  /** POST /dev/seed is open only when this returns true (env ALTAMIRA_DEV_SEED === 'true'). */
  devSeedEnabled(env: Env): boolean
  /** Deletes a stored upload, e.g. voice-note audio once converted (PRD NFR Consent). */
  deleteFile(env: Env, fileKey: string, ownerUserId: string): Promise<void>
  /** Reads the printed sheet code of a photographed page, or null. */
  readSheetCode(page: MediaRef): string | null
  /** Forwards the live timeline WebSocket to the student room (optional). */
  openLive?(env: Env, studentId: string, request: Request): Promise<Response>
  /** Handler for errors that are not Altamira errors (500). */
  fallbackError?: ErrorHandler<AltamiraEnv>
  now(): number
}

/**
 * The client app reads the code printed on each sheet and names the uploaded
 * page after it (".../sheet-code-AL-XXXXXXXX.jpg"); the fixture provider uses
 * the same convention.
 */
export function sheetCodeFromFileKey(page: MediaRef): string | null {
  return page.fileKey.match(/sheet[-_]?code[-_](AL-[A-Za-z0-9]+)/i)?.[1]?.toUpperCase() ?? null
}
