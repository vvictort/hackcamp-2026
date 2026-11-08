import type { Env } from '../../../../worker'
import { SYSTEM_ACTOR, type JobDeps } from './jobs-core'
import { schoolRoom, studentRoom } from './stubs'

/** Real-room deps for src/cron.ts. */
export function jobDeps(env: Env): JobDeps {
  return {
    listStudentIds: () => schoolRoom(env).listStudentIds(),
    runStudentOp: (studentId, opName, args) => studentRoom(env, studentId).run(opName, args, SYSTEM_ACTOR),
    log: (message) => console.log(message),
  }
}
