import type { OpRegistry, RoomName } from '../contract/ops'
import { userActor, type Actor } from '../contract/permissions'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateInsights } from '../db/schema/insights'
import { migrateSchool } from '../db/schema/school'
import { migrateStudent } from '../db/schema/student'
import type { SqlExecutor } from '../db/sql'
import { CLASS_IDS, DISTRICT, STUDENT_IDS, USER_IDS, seedSchool, seedStudent, studentFixture, type FixtureStudentKey } from '../fixtures'
import { unwrapOp } from '../middleware/errors'
import { runRoomOp } from '../rooms/core'
import { insightsOps, schoolOps, studentOps } from '../services/registry'

/**
 * Test-only helpers: rooms on node:sqlite seeded with the fictional fixtures,
 * actors matching the fixture memberships, and runners that go through
 * runRoomOp like a room. Imported only by *.test.ts files.
 */

const open: { close(): void }[] = []
export const closeAll = () => open.splice(0).forEach((db) => db.close())

export function studentRoom(key?: FixtureStudentKey) {
  const sql = createNodeSqlExecutor()
  open.push(sql)
  migrateStudent(sql)
  if (key) seedStudent(sql, studentFixture(key))
  return sql
}

export function schoolRoom(seed = true) {
  const sql = createNodeSqlExecutor()
  open.push(sql)
  migrateSchool(sql)
  if (seed) seedSchool(sql)
  return sql
}

export function insightsRoom() {
  const sql = createNodeSqlExecutor()
  open.push(sql)
  migrateInsights(sql)
  return sql
}

const REGISTRIES = { student: studentOps, school: schoolOps, insights: insightsOps } satisfies Record<RoomName, OpRegistry>

/** Runs an op the way its room does, audit enforcement included, and throws the op's error. */
function runIn<T>(room: RoomName, sql: SqlExecutor, name: string, args: unknown, actor: Actor): T {
  return unwrapOp(runRoomOp(sql, REGISTRIES[room], name, args, actor, { room, requireAudit: room !== 'insights' })) as T
}

export const runStudent = <T>(sql: SqlExecutor, name: string, args: unknown, actor: Actor) => runIn<T>('student', sql, name, args, actor)
export const runSchool = <T>(sql: SqlExecutor, name: string, args: unknown, actor: Actor) => runIn<T>('school', sql, name, args, actor)
export const runInsights = <T>(sql: SqlExecutor, name: string, args: unknown, actor: Actor) => runIn<T>('insights', sql, name, args, actor)

const { kai, amara, sofia } = STUDENT_IDS

/** Actors as altamyraAuth would build them from the fixture memberships. */
export const ACTORS = {
  caseManager: userActor(USER_IDS.caseManager, {
    studentRoles: { [kai]: ['case_manager'], [amara]: ['case_manager'], [sofia]: ['case_manager'] },
  }),
  teacher: userActor(USER_IDS.teacher, {
    studentRoles: { [kai]: ['teacher'], [amara]: ['teacher'], [sofia]: ['teacher'] },
    classIds: Object.values(CLASS_IDS),
  }),
  ea: userActor(USER_IDS.ea, { studentRoles: { [kai]: ['ea'], [sofia]: ['ea'] } }),
  parentKai: userActor(USER_IDS.parentKai, { parentOf: [kai] }),
  parentAmara: userActor(USER_IDS.parentAmara, { parentOf: [amara] }),
  parentSofia: userActor(USER_IDS.parentSofia, { parentOf: [sofia] }),
  districtLead: userActor(USER_IDS.districtLead, { districtLeadOf: [DISTRICT.id] }),
  system: userActor('system:test'),
} satisfies Record<string, Actor>

export const countRows = (sql: SqlExecutor, table: string) => sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0
