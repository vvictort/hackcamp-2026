import type { ErrorHandler } from 'hono'
import type { Env } from '../../../../worker'
import type { AiProvider } from '../contract/ai'
import type { Roster } from '../ai/deidentify'
import type { SummaryProvider } from '../ai/summaries-provider'
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
  aiProvider(env: Env, teacher?: string): AiProvider
  summaryProvider(env: Env): SummaryProvider
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
  /** Streams a stored upload out of the uploader's private folder (GET /students/:id/file). */
  fileDownload?(env: Env, ownerUserId: string, fileKey: string): Promise<Response>
  /** Forwards the live timeline WebSocket to the student room (optional). */
  openLive?(env: Env, studentId: string, request: Request): Promise<Response>
  fallbackError: ErrorHandler<AltamyraEnv>
  now(): number
}
