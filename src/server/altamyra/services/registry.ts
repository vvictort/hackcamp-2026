import type { OpRegistry, RoomOp, RoomName } from '../contract/ops'
import { devResetSchool, studentDevSeedDemo } from '../fixtures/demo'
import { devDemoStudent } from '../fixtures/demo-day'
import { deidSchoolRoster, deidStudentNames } from './deid'
import { devRoleSwitch } from './dev'
import { familyOpList } from './family'
import { insightsOpList } from './insights'
import { integrationSchoolOps, integrationStudentOps } from './integration'
import { lensOpList } from './lens'
import { lessonPlanOpList } from './lesson-plans'
import { measurementOpList } from './measurement'
import { progressOpList } from './progress'
import { schoolOpList } from './school'
import { ticketSchoolOps, ticketStudentOps } from './tickets'

/**
 * Room op registries, one per room kind. Each room's run(opName, args, actor)
 * looks the op up here and runs it inside one transaction.
 * Owned by the Domain engineer, who adds ops; keys must equal each op's name.
 */

function registry(room: RoomName, ops: readonly RoomOp[]): OpRegistry {
  const out: OpRegistry = {}
  for (const op of ops) {
    if (op.room !== room) throw new Error(`op ${op.name} belongs to the ${op.room} room, not ${room}`)
    if (out[op.name]) throw new Error(`duplicate op name ${op.name}`)
    out[op.name] = op
  }
  return out
}

export const studentOps: OpRegistry = registry('student', [
  ...lensOpList,
  ...measurementOpList,
  ...progressOpList,
  ...familyOpList,
  ...integrationStudentOps,
  ...ticketStudentOps,
  studentDevSeedDemo,
  deidStudentNames,
])

export const schoolOps: OpRegistry = registry('school', [...schoolOpList, ...lessonPlanOpList, ...ticketSchoolOps, ...integrationSchoolOps, deidSchoolRoster, devResetSchool, devDemoStudent, devRoleSwitch])

export const insightsOps: OpRegistry = registry('insights', insightsOpList)
