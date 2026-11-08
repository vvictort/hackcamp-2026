import { appendAudit } from '../db/audit'
import { insertRow, toRow } from '../db/mapping'
import type { SqlExecutor } from '../db/sql'
import { CLASSES, MEMBERSHIPS, PARENT_LINKS, ROSTER, SCHEDULE_BLOCKS, SCHOOL_STUDENTS, SEEDED_AT, USERS } from './school'
import type { StudentFixture } from './students'

/**
 * Loads fixtures into a migrated room, in one transaction with one audit row.
 * For tests and the dev-only POST /dev/seed route. Not idempotent: seed an
 * empty room once.
 */

const SEED_ACTOR = 'system:fixtures'

export function seedSchool(sql: SqlExecutor): void {
  sql.transaction(() => {
    USERS.forEach((u) => insertRow(sql, 'users', toRow(u)))
    SCHOOL_STUDENTS.forEach((s) => insertRow(sql, 'students', toRow(s)))
    CLASSES.forEach((c) => insertRow(sql, 'classes', toRow(c)))
    MEMBERSHIPS.forEach((m) => insertRow(sql, 'memberships', toRow(m)))
    PARENT_LINKS.forEach((p) => insertRow(sql, 'parent_links', toRow(p)))
    ROSTER.forEach((r) => insertRow(sql, 'roster', toRow(r)))
    SCHEDULE_BLOCKS.forEach((b) => insertRow(sql, 'schedule_blocks', toRow(b)))
    appendAudit(sql, { actorId: SEED_ACTOR, action: 'fixtures.seed', tableName: 'users', rowId: '*', at: SEEDED_AT })
  })
}

export function seedStudent(sql: SqlExecutor, fixture: StudentFixture): void {
  sql.transaction(() => {
    insertRow(sql, 'iep_versions', toRow(fixture.iep))
    fixture.goals.forEach(({ exampleId: _exampleId, ...g }) => insertRow(sql, 'goals', toRow(g)))
    fixture.objectives.forEach((o) => insertRow(sql, 'objectives', toRow(o)))
    fixture.dataPoints.forEach((d) => insertRow(sql, 'data_points', toRow(d, ['sessionDetail'])))
    fixture.consents.forEach((c) => insertRow(sql, 'consents', toRow(c)))
    fixture.proficiency.forEach((p) => insertRow(sql, 'proficiency_ratings', toRow(p)))
    appendAudit(sql, {
      actorId: SEED_ACTOR,
      action: 'fixtures.seed',
      tableName: 'iep_versions',
      rowId: fixture.iep.id,
      at: SEEDED_AT,
    })
  })
}
