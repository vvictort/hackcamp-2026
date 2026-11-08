import type { OpRegistry } from '../contract/ops'
import { userActor, type Actor } from '../contract/permissions'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateInsights } from '../db/schema/insights'
import { migrateSchool } from '../db/schema/school'
import { migrateStudent } from '../db/schema/student'
import type { SqlExecutor } from '../db/sql'
import { CLASS_IDS, STUDENT_IDS, USER_IDS, seedSchool, seedStudent, studentFixture, type FixtureStudentKey } from '../fixtures'
import { insightsOps, schoolOps, studentOps } from './registry'

/**
 * Test-only helpers: rooms on node:sqlite seeded with the fictional fixtures,
 * actors matching the fixture memberships, and a runner that behaves like a
 * room's run(opName, args, actor). Imported only by *.test.ts files.
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

/** Same steps as a room: look up, parse args, run inside one transaction. */
export function runIn<T>(registry: OpRegistry, sql: SqlExecutor, name: string, args: unknown, actor: Actor): T {
  const op = registry[name]
  if (!op) throw new Error(`no op ${name}`)
  const parsed = op.args ? op.args.parse(args) : args
  return sql.transaction(() => op.run(sql, parsed, actor)) as T
}

export const runStudent = <T>(sql: SqlExecutor, name: string, args: unknown, actor: Actor) => runIn<T>(studentOps, sql, name, args, actor)
export const runSchool = <T>(sql: SqlExecutor, name: string, args: unknown, actor: Actor) => runIn<T>(schoolOps, sql, name, args, actor)
export const runInsights = <T>(sql: SqlExecutor, name: string, args: unknown, actor: Actor) => runIn<T>(insightsOps, sql, name, args, actor)

const { kai, amara, sofia } = STUDENT_IDS

/** Actors as altamiraAuth would build them from the fixture memberships. */
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
  districtLead: userActor(USER_IDS.districtLead, { districtLeadOf: ['d1500000-0000-4000-8000-000000000099'] }),
  system: userActor('system:test'),
} satisfies Record<string, Actor>

export const countRows = (sql: SqlExecutor, table: string) => sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0
