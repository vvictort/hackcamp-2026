import type { OpRegistry, RoomOp, RoomName } from '../contract/ops'
import { familyOpList } from './family'
import { insightOpList } from './insight'
import { insightsOpList } from './insights'
import { integrationSchoolOps, integrationStudentOps } from './integration'
import { lensOpList } from './lens'
import { measurementOpList } from './measurement'
import { schoolOpList } from './school'
import { studentModeOpList } from './student-mode'

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
  ...studentModeOpList,
  ...insightOpList,
  ...familyOpList,
  ...integrationStudentOps,
])

export const schoolOps: OpRegistry = registry('school', [...schoolOpList, ...integrationSchoolOps])

export const insightsOps: OpRegistry = registry('insights', insightsOpList)
