import type { OpResult, RoomName } from '../contract/ops'
import { userActor, type Actor } from '../contract/permissions'

/**
 * Scheduled and background Altamira work (design doc "Jobs"), written over
 * injected deps so it runs in Vitest. src/cron.ts and src/server/jobs.ts wire
 * the real rooms. Ops are called by name; an op the registry does not have is
 * skipped, not failed. Voice notes are processed in the request
 * (routes/capture.ts), which deletes the audio, so there is no voice-note job.
 */

export const SYSTEM_ACTOR: Actor = userActor('system:jobs')

export const ALTAMIRA_CRON = {
  // CronRoom only accepts lowercase letters, digits and hyphens in task names.
  dataNeeded: 'altamira-data-needed',
} as const

/** Which op each cron task runs, and in which room kind. */
export const CRON_OPS: Record<string, { room: Extract<RoomName, 'student' | 'school'>; op: string }> = {
  // Daily: data-needed scan per active objective (PRD: fewer than 2 points in 2 weeks).
  [ALTAMIRA_CRON.dataNeeded]: { room: 'student', op: 'dataNeeded.scan' },
}

export type JobDeps = {
  isRegistered(room: RoomName, opName: string): boolean
  listStudentIds(): Promise<string[]>
  runStudentOp(studentId: string, opName: string, args: unknown): Promise<OpResult>
  runSchoolOp(opName: string, args: unknown): Promise<OpResult>
  log(message: string): void
  /** Clock for tests; defaults to the current time. */
  now?(): Date
}

export type CronOutcome =
  | { status: 'not_altamira' }
  | { status: 'skipped'; reason: 'op_missing'; op: string }
  | { status: 'done'; op: string; ran: number; failed: number }

/** Runs one Altamira cron task. One student's failure does not stop the rest. */
export async function runAltamiraCronTask(name: string, deps: JobDeps): Promise<CronOutcome> {
  const target = CRON_OPS[name]
  if (!target) return { status: 'not_altamira' }
  if (!deps.isRegistered(target.room, target.op)) {
    deps.log(`altamira cron ${name}: op ${target.op} not registered, skipped`)
    return { status: 'skipped', reason: 'op_missing', op: target.op }
  }

  const now = (deps.now?.() ?? new Date()).toISOString()
  if (target.room === 'school') {
    const result = await deps.runSchoolOp(target.op, { now })
    if (!result.ok) deps.log(`altamira cron ${name}: ${result.error.code}`)
    return { status: 'done', op: target.op, ran: 1, failed: result.ok ? 0 : 1 }
  }

  let ran = 0
  let failed = 0
  for (const studentId of await deps.listStudentIds()) {
    ran++
    try {
      // Student-room ops take the student id (StudentArgs) and the job's clock.
      const result = await deps.runStudentOp(studentId, target.op, { studentId, now })
      if (!result.ok) failed++
    } catch {
      failed++
    }
  }
  // Counts only: no student ids in logs.
  if (failed > 0) deps.log(`altamira cron ${name}: ${failed} of ${ran} student rooms failed`)
  return { status: 'done', op: target.op, ran, failed }
}
