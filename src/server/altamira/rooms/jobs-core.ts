import { z } from 'zod'
import type { OpResult, RoomName } from '../contract/ops'
import { userActor, type Actor } from '../contract/permissions'

/**
 * Scheduled and background Altamira work (design doc "Jobs"), written over
 * injected deps so it runs in Vitest. src/cron.ts and src/server/jobs.ts wire
 * the real rooms. Ops are called by name; an op the Domain registry does not
 * have yet is skipped, not failed.
 */

export const SYSTEM_ACTOR: Actor = userActor('system:jobs')

export const ALTAMIRA_CRON = {
  weeklyDigest: 'altamira.weekly-digest',
  dataNeeded: 'altamira.data-needed',
  todayLinkExpiry: 'altamira.today-link-expiry',
} as const

/** Which op each cron task runs, and in which room kind. */
export const CRON_OPS: Record<string, { room: Extract<RoomName, 'student' | 'school'>; op: string }> = {
  // Weekly: case-manager digest of decision-rule events.
  [ALTAMIRA_CRON.weeklyDigest]: { room: 'student', op: 'digest.weekly' },
  // Daily: data-needed scan per active objective (PRD: fewer than 2 points in 2 weeks).
  [ALTAMIRA_CRON.dataNeeded]: { room: 'student', op: 'dataNeeded.scan' },
  // Daily: expire Today View links.
  [ALTAMIRA_CRON.todayLinkExpiry]: { room: 'school', op: 'shareTokens.expire' },
}

export type JobDeps = {
  isRegistered(room: RoomName, opName: string): boolean
  listStudentIds(): Promise<string[]>
  runStudentOp(studentId: string, opName: string, args: unknown): Promise<OpResult>
  runSchoolOp(opName: string, args: unknown): Promise<OpResult>
  log(message: string): void
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

  const args = { at: new Date().toISOString() }
  if (target.room === 'school') {
    const result = await deps.runSchoolOp(target.op, args)
    if (!result.ok) deps.log(`altamira cron ${name}: ${result.error.code}`)
    return { status: 'done', op: target.op, ran: 1, failed: result.ok ? 0 : 1 }
  }

  let ran = 0
  let failed = 0
  for (const studentId of await deps.listStudentIds()) {
    ran++
    try {
      const result = await deps.runStudentOp(studentId, target.op, args)
      if (!result.ok) failed++
    } catch {
      failed++
    }
  }
  // Counts only: no student ids in logs.
  if (failed > 0) deps.log(`altamira cron ${name}: ${failed} of ${ran} student rooms failed`)
  return { status: 'done', op: target.op, ran, failed }
}

export const VOICE_NOTE_JOB = 'altamira.voice-note'

export const VoiceNoteJobPayload = z.object({
  studentId: z.string().min(1),
  /** App file key of the recording. */
  audioKey: z.string().min(1),
  /** The EA who uploaded it; the file sits in their private folder. */
  uploadedBy: z.string().min(1),
}).passthrough()
export type VoiceNoteJobPayload = z.infer<typeof VoiceNoteJobPayload>

export type VoiceNoteDeps = Pick<JobDeps, 'isRegistered' | 'runStudentOp' | 'log'> & {
  hasAudioConsent(studentId: string): Promise<boolean>
  deleteAudio(payload: VoiceNoteJobPayload): Promise<void>
  /** Optional AI step (parseVoiceNote on de-identified input); its output is passed to the op as `events`. */
  parse?(payload: VoiceNoteJobPayload): Promise<unknown>
}

export type VoiceNoteOutcome = { processed: boolean; audioDeleted: boolean; reason?: 'no_consent' | 'op_missing' }

/**
 * PRD NFR Privacy: recordings are converted to metrics and deleted, and need
 * parental consent. Without consent the audio is deleted unprocessed. If the
 * op fails the job throws and keeps the audio so the retry can process it.
 */
export async function runVoiceNoteJob(rawPayload: unknown, deps: VoiceNoteDeps): Promise<VoiceNoteOutcome> {
  const payload = VoiceNoteJobPayload.parse(rawPayload)

  if (!(await deps.hasAudioConsent(payload.studentId))) {
    await deps.deleteAudio(payload)
    return { processed: false, audioDeleted: true, reason: 'no_consent' }
  }
  if (!deps.isRegistered('student', 'voiceNote.process')) {
    deps.log('altamira voice note: op voiceNote.process not registered, skipped')
    return { processed: false, audioDeleted: false, reason: 'op_missing' }
  }

  const events = deps.parse ? await deps.parse(payload) : undefined
  const result = await deps.runStudentOp(payload.studentId, 'voiceNote.process', { ...payload, events })
  if (!result.ok) throw new Error(`voiceNote.process failed: ${result.error.code}`)

  await deps.deleteAudio(payload)
  return { processed: true, audioDeleted: true }
}
