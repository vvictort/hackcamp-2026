import type { ErrorHandler } from 'hono'
import type { Env } from '../../../../worker'
import type { AiProvider } from '../contract/ai'
import type { MediaRef } from '../contract/common'
import type { Roster } from '../ai/deidentify'
import type { AltamyraEnv } from '../middleware/auth'
import type { InsightsRoomRpc, SchoolRoomRpc, StudentRoomRpc } from '../rooms/rpc'

/**
 * Everything the /api/v1 routes reach outside themselves. Production values
 * live in routes/defaults.ts; tests pass in-memory rooms on node:sqlite.
 */
export type AltamyraRouteDeps = {
  rooms: {
    student(env: Env, studentId: string): StudentRoomRpc
    school(env: Env): SchoolRoomRpc
    insights(env: Env): InsightsRoomRpc
  }
  /** The DeepSpace userId for the request, or null when not signed in. */
  resolveUserId(req: Request, env: Env): Promise<string | null>
  /** AI provider (env ALTAMYRA_AI_PROVIDER; fixture by default). */
  aiProvider(env: Env): AiProvider
  /**
   * Base de-identification roster: names no room stores (the school and
   * district names). Req.ai() adds every user's name and the IEP names of the
   * students in the call. Tests may add the fictional fixture roster.
   */
  roster(env: Env): Roster | Promise<Roster>
  /** Seed for the random review sample; defaults to crypto.randomUUID(). Tests pass a fixed sequence. */
  sampleSeed?(): string
  /** The single school and district this deployment serves. */
  schoolId(env: Env): string
  districtId(env: Env): string
  /** POST /dev/seed is open only when this returns true (env ALTAMYRA_DEV_SEED === 'true'). */
  devSeedEnabled(env: Env): boolean
  /** Deletes a stored upload, e.g. voice-note audio once converted (PRD NFR Consent). */
  deleteFile(env: Env, fileKey: string, ownerUserId: string): Promise<void>
  /** Reads the printed sheet code of a photographed page, or null. */
  readSheetCode(page: MediaRef): string | null
  /** Forwards the live timeline WebSocket to the student room (optional). */
  openLive?(env: Env, studentId: string, request: Request): Promise<Response>
  /** Handler for errors that are not Altamyra errors (500). */
  fallbackError?: ErrorHandler<AltamyraEnv>
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
