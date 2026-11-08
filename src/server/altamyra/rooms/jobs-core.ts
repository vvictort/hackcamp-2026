import type { OpResult } from '../contract/ops'
import { userActor, type Actor } from '../contract/permissions'
import { dataNeededScan } from '../services/progress'

/**
 * Scheduled Altamyra work (design doc "Jobs"), written over injected deps so it
 * runs in Vitest. src/cron.ts wires the real rooms. Voice notes are processed in
 * the request (routes/capture.ts), which deletes the audio, so there is no voice-note job.
 */

export const SYSTEM_ACTOR: Actor = userActor('system:jobs')

export const ALTAMYRA_CRON = {
  // CronRoom only accepts lowercase letters, digits and hyphens in task names.
  dataNeeded: 'altamyra-data-needed',
} as const

export type JobDeps = {
  listStudentIds(): Promise<string[]>
  runStudentOp(studentId: string, opName: string, args: unknown): Promise<OpResult>
  log(message: string): void
  /** Clock for tests; defaults to the current time. */
  now?(): Date
}

export type CronOutcome = { status: 'not_altamyra' } | { status: 'done'; ran: number; failed: number }

/** Runs the daily data-needed scan (PRD: fewer than 2 points in 2 weeks) in every student room. One student's failure does not stop the rest. */
export async function runAltamyraCronTask(name: string, deps: JobDeps): Promise<CronOutcome> {
  if (name !== ALTAMYRA_CRON.dataNeeded) return { status: 'not_altamyra' }
  const now = (deps.now?.() ?? new Date()).toISOString()
  let ran = 0
  let failed = 0
  for (const studentId of await deps.listStudentIds()) {
    ran++
    try {
      const result = await deps.runStudentOp(studentId, dataNeededScan.name, { studentId, now })
      if (!result.ok) failed++
    } catch {
      failed++
    }
  }
  // Counts only: no student ids in logs.
  if (failed > 0) deps.log(`altamyra cron ${name}: ${failed} of ${ran} student rooms failed`)
  return { status: 'done', ran, failed }
}
