import { appFiles } from 'deepspace/worker'
import type { Env } from '../../../../worker'
import type { RoomName } from '../contract/ops'
import { insightsOps, schoolOps, studentOps } from '../services/registry'
import { SYSTEM_ACTOR, type JobDeps, type VoiceNoteDeps } from './jobs-core'
import { schoolRoom, studentRoom } from './stubs'

const REGISTRIES = { student: studentOps, school: schoolOps, insights: insightsOps } as const

/** Real-room deps for src/cron.ts and src/server/jobs.ts. */
export function jobDeps(env: Env): JobDeps {
  return {
    isRegistered: (room: RoomName, opName: string) => Object.hasOwn(REGISTRIES[room], opName),
    listStudentIds: () => schoolRoom(env).listStudentIds(),
    runStudentOp: (studentId, opName, args) => studentRoom(env, studentId).run(opName, args, SYSTEM_ACTOR),
    runSchoolOp: (opName, args) => schoolRoom(env).run(opName, args, SYSTEM_ACTOR),
    log: (message) => console.log(message),
  }
}

export function voiceNoteDeps(env: Env): VoiceNoteDeps {
  return {
    ...jobDeps(env),
    hasAudioConsent: (studentId) => studentRoom(env, studentId).hasConsent('audio'),
    deleteAudio: async ({ audioKey, uploadedBy }) => {
      await appFiles(env, { scope: 'self', userId: uploadedBy }).delete(audioKey)
    },
  }
}
