import { describe, expect, it, vi } from 'vitest'
import { opErr, opOk } from '../contract/ops'
import { STUDENT_IDS, USER_IDS } from '../fixtures/school'
import { ALTAMIRA_CRON, runAltamiraCronTask, runVoiceNoteJob, SYSTEM_ACTOR, type JobDeps, type VoiceNoteDeps } from './jobs-core'

const students = Object.values(STUDENT_IDS)

function deps(registered: string[], overrides: Partial<JobDeps> = {}): JobDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    logs,
    isRegistered: (_room, op) => registered.includes(op),
    listStudentIds: async () => students,
    runStudentOp: vi.fn(async () => opOk(null)),
    runSchoolOp: vi.fn(async () => opOk(null)),
    log: (m) => logs.push(m),
    ...overrides,
  }
}

describe('Altamira cron tasks', () => {
  it('ignores tasks that are not Altamira', async () => {
    expect(await runAltamiraCronTask('heartbeat', deps([]))).toEqual({ status: 'not_altamira' })
  })

  it('skips a task whose op is not registered yet, without calling any room', async () => {
    const d = deps([])
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.weeklyDigest, d)).toEqual({ status: 'skipped', reason: 'op_missing', op: 'digest.weekly' })
    expect(d.runStudentOp).not.toHaveBeenCalled()
    expect(d.logs).toHaveLength(1)
  })

  it('runs per-student ops in every student room and counts failures without logging ids', async () => {
    const d = deps(['dataNeeded.scan'], {
      runStudentOp: vi.fn(async (id: string) => {
        if (id === STUDENT_IDS.amara) throw new Error('boom')
        if (id === STUDENT_IDS.sofia) return opErr('not_found', 'x')
        return opOk(null)
      }),
    })
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.dataNeeded, d)).toEqual({ status: 'done', op: 'dataNeeded.scan', ran: 3, failed: 2 })
    expect(d.logs.join(' ')).not.toMatch(/57d0/)
  })

  it('runs link expiry in the school room', async () => {
    const d = deps(['shareTokens.expire'])
    expect(await runAltamiraCronTask(ALTAMIRA_CRON.todayLinkExpiry, d)).toEqual({ status: 'done', op: 'shareTokens.expire', ran: 1, failed: 0 })
    expect(d.runSchoolOp).toHaveBeenCalledWith('shareTokens.expire', expect.any(Object))
  })

  it('uses a system actor with no roles', () => {
    expect(SYSTEM_ACTOR.studentRoles).toEqual({})
    expect(SYSTEM_ACTOR.session).toBeNull()
  })
})

describe('voice-note job', () => {
  const payload = { studentId: STUDENT_IDS.kai, audioKey: 'voice/fictional.webm', uploadedBy: USER_IDS.ea }

  function voiceDeps(over: Partial<VoiceNoteDeps> = {}): VoiceNoteDeps {
    return {
      ...deps(['voiceNote.process']),
      hasAudioConsent: async () => true,
      deleteAudio: vi.fn(async () => {}),
      ...over,
    }
  }

  it('processes, then deletes the audio', async () => {
    const d = voiceDeps({ parse: async () => [{ kind: 'counter' }] })
    expect(await runVoiceNoteJob(payload, d)).toEqual({ processed: true, audioDeleted: true })
    expect(d.runStudentOp).toHaveBeenCalledWith(STUDENT_IDS.kai, 'voiceNote.process', { ...payload, events: [{ kind: 'counter' }] })
    expect(d.deleteAudio).toHaveBeenCalledOnce()
  })

  it('deletes the audio unprocessed when there is no audio consent', async () => {
    const d = voiceDeps({ hasAudioConsent: async () => false })
    expect(await runVoiceNoteJob(payload, d)).toEqual({ processed: false, audioDeleted: true, reason: 'no_consent' })
    expect(d.runStudentOp).not.toHaveBeenCalled()
  })

  it('keeps the audio and throws (so the job retries) when the op fails', async () => {
    const d = voiceDeps({ runStudentOp: vi.fn(async () => opErr('bad_request', 'x')) })
    await expect(runVoiceNoteJob(payload, d)).rejects.toThrow('voiceNote.process failed: bad_request')
    expect(d.deleteAudio).not.toHaveBeenCalled()
  })

  it('skips gracefully when the op is not registered', async () => {
    const d = voiceDeps({ isRegistered: () => false })
    expect(await runVoiceNoteJob(payload, d)).toEqual({ processed: false, audioDeleted: false, reason: 'op_missing' })
  })

  it('rejects a malformed payload', async () => {
    await expect(runVoiceNoteJob({ studentId: '' }, voiceDeps())).rejects.toThrow()
  })
})
