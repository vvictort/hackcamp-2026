import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { can } from '../contract/permissions'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateSchool } from '../db/schema/school'
import { DISTRICT, MEMBERSHIPS, PARENT_LINKS, ROSTER, SCHOOL, seedSchool, STUDENT_IDS, USER_IDS } from '../fixtures'
import { listStudentIds, loadActor } from './actor'

type Sql = ReturnType<typeof createNodeSqlExecutor>

describe('loadActor', () => {
  let sql: Sql
  beforeEach(() => {
    sql = createNodeSqlExecutor()
    migrateSchool(sql)
    seedSchool(sql)
  })
  afterEach(() => sql.close())

  it('gives a teacher the teacher role for every student on their class rosters', () => {
    const actor = loadActor(sql, USER_IDS.teacher, SCHOOL.id)
    const classIds = MEMBERSHIPS.filter((m) => m.userId === USER_IDS.teacher && m.role === 'teacher').map((m) => m.classId)
    const expected = [...new Set(ROSTER.filter((r) => classIds.includes(r.classId)).map((r) => r.studentId))].sort()
    expect(Object.keys(actor.studentRoles).sort()).toEqual(expected)
    for (const id of expected) expect(actor.studentRoles[id]).toContain('teacher')
    expect(actor.classIds.sort()).toEqual([...new Set(classIds)].sort())
  })

  it('gives case managers and EAs the students their memberships name', () => {
    for (const userId of [USER_IDS.caseManager, USER_IDS.ea]) {
      const actor = loadActor(sql, userId, SCHOOL.id)
      for (const m of MEMBERSHIPS.filter((x) => x.userId === userId && x.studentId)) {
        expect(actor.studentRoles[m.studentId!]).toContain(m.role)
      }
    }
  })

  it('gives a parent only their own child', () => {
    const actor = loadActor(sql, USER_IDS.parentKai, SCHOOL.id)
    expect(actor.parentOf).toEqual(PARENT_LINKS.filter((p) => p.parentUserId === USER_IDS.parentKai).map((p) => p.studentId))
    expect(can(actor, 'progress.view', STUDENT_IDS.kai).allowed).toBe(true)
    expect(can(actor, 'progress.view', STUDENT_IDS.amara).allowed).toBe(false)
  })

  it('maps school admin and district lead memberships', () => {
    expect(loadActor(sql, USER_IDS.schoolAdmin, SCHOOL.id).schoolAdminOf).toEqual([SCHOOL.id])
    const lead = loadActor(sql, USER_IDS.districtLead, SCHOOL.id)
    expect(lead.districtLeadOf).toEqual([DISTRICT.id])
    expect(Object.keys(lead.studentRoles)).toEqual([])
  })

  it('gives an unknown user nothing', () => {
    const actor = loadActor(sql, 'stranger', SCHOOL.id)
    expect(actor).toMatchObject({ studentRoles: {}, parentOf: [], classIds: [], session: null })
  })

  it('lists student ids', () => {
    expect(listStudentIds(sql)).toEqual(Object.values(STUDENT_IDS).sort())
  })
})
