import type { Env } from '../../../../worker'
import type { RoomName } from '../contract/ops'
import { insightsOps, schoolOps, studentOps } from '../services/registry'
import { SYSTEM_ACTOR, type JobDeps } from './jobs-core'
import { schoolRoom, studentRoom } from './stubs'

const REGISTRIES = { student: studentOps, school: schoolOps, insights: insightsOps } as const

/** Real-room deps for src/cron.ts. */
export function jobDeps(env: Env): JobDeps {
  return {
    isRegistered: (room: RoomName, opName: string) => Object.hasOwn(REGISTRIES[room], opName),
    listStudentIds: () => schoolRoom(env).listStudentIds(),
    runStudentOp: (studentId, opName, args) => studentRoom(env, studentId).run(opName, args, SYSTEM_ACTOR),
    runSchoolOp: (opName, args) => schoolRoom(env).run(opName, args, SYSTEM_ACTOR),
    log: (message) => console.log(message),
  }
}
