import { afterEach, describe, expect, it } from 'vitest'
import type { MeResponse } from '../contract/api'
import { AltamyraError } from '../contract/errors'
import { userActor } from '../contract/permissions'
import type { Lesson, SheetCode } from '../contract/school'
import { CLASS_IDS, FIXTURE_NAMES, SCHOOL, STUDENT_IDS, USER_IDS } from '../fixtures'
import { ACTORS, closeAll, runSchool, schoolRoom } from '../e2e/testing'

afterEach(closeAll)

const admin = userActor(USER_IDS.schoolAdmin, { schoolAdminOf: [SCHOOL.id] })

function lesson(sql = schoolRoom()) {
  const { lesson } = runSchool<{ lesson: Lesson }>(
    sql,
    'lessons.create',
    { classId: CLASS_IDS.literacy, title: 'Salmon life cycle', sourceKind: 'text', text: 'Salmon hatch in rivers.', scheduledFor: '2026-11-02' },
    ACTORS.teacher,
  )
  return { sql, lesson }
}

describe('dev.seed', () => {
  it('seeds an empty school room once', () => {
    const sql = schoolRoom(false)
    const res = runSchool<{ schoolId: string; studentIds: string[] }>(sql, 'dev.seed', {}, ACTORS.system)
    expect(res.schoolId).toBe(SCHOOL.id)
    expect(res.studentIds).toHaveLength(3)
    expect(() => runSchool(sql, 'dev.seed', {}, ACTORS.system)).toThrow(/already seeded/)
  })
})

describe('memberships.assign', () => {
  const grant = { kind: 'membership', userId: 'new-ea', displayName: 'Fictional EA', role: 'ea', studentId: STUDENT_IDS.amara }

  it('only a school administrator assigns roles', () => {
    const sql = schoolRoom()
    expect(() => runSchool(sql, 'memberships.assign', { schoolId: SCHOOL.id, grant }, ACTORS.caseManager)).toThrow(/membership.manage/)
    const res = runSchool<{ membership: { role: string } }>(sql, 'memberships.assign', { schoolId: SCHOOL.id, grant }, admin)
    expect(res.membership.role).toBe('ea')
    runSchool(sql, 'memberships.assign', { schoolId: SCHOOL.id, grant }, admin)
    expect(sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE user_id = 'new-ea'")?.n).toBe(1)
  })

  it('rejects a grant with the wrong scope fields', () => {
    const sql = schoolRoom()
    expect(() => runSchool(sql, 'memberships.assign', { schoolId: SCHOOL.id, grant: { ...grant, role: 'teacher' } }, admin)).toThrow(/wrong scope/)
  })
})

describe('lessons (PRD 1A-1)', () => {
  it('teachers create lessons; EAs cannot', () => {
    const { sql, lesson: l } = lesson()
    expect(l.createdBy).toBe(USER_IDS.teacher)
    expect(() => runSchool(sql, 'lessons.create', { classId: CLASS_IDS.literacy, title: 'x', sourceKind: 'text', text: 'y' }, ACTORS.ea)).toThrow(/lesson_plan.edit/)
  })
})

describe('sheet codes (no names)', () => {
  it('issues one stable, name-free code per student, lesson and check', () => {
    const { sql, lesson: l } = lesson()
    const args = { studentId: STUDENT_IDS.kai, lessonId: l.id, checkId: 'check-1' }
    const { sheetCode } = runSchool<{ sheetCode: SheetCode }>(sql, 'sheetCodes.issue', args, ACTORS.teacher)
    expect(sheetCode.code).toMatch(/^AL-[2-9A-Z]{8}$/)
    for (const name of FIXTURE_NAMES) expect(sheetCode.code.toLowerCase()).not.toContain(name.toLowerCase())
    expect(runSchool<{ sheetCode: SheetCode }>(sql, 'sheetCodes.issue', args, ACTORS.teacher).sheetCode.code).toBe(sheetCode.code)
    expect(runSchool<{ sheetCode: SheetCode }>(sql, 'sheetCodes.resolve', { code: sheetCode.code.toLowerCase() }, ACTORS.ea).sheetCode).toEqual(sheetCode)
    expect(() => runSchool(sql, 'sheetCodes.resolve', { code: 'AL-NOPE' }, ACTORS.ea)).toThrow(/unknown/)
  })
})

describe('memberships.list (school administrator Roles page)', () => {
  it('lists every role holder with scope, parents included', () => {
    const sql = schoolRoom()
    const { memberships } = runSchool<{ memberships: { userId: string; displayName: string; role: string; studentId: string | null; classId: string | null }[] }>(sql, 'memberships.list', { schoolId: SCHOOL.id }, admin)
    const roles = new Set(memberships.map((m) => m.role))
    expect([...roles].sort()).toEqual(['case_manager', 'district_lead', 'ea', 'parent', 'school_admin', 'teacher'])
    const ea = memberships.filter((m) => m.role === 'ea')
    expect(ea.map((m) => m.studentId).sort()).toEqual([STUDENT_IDS.kai, STUDENT_IDS.sofia].sort())
    expect(ea[0]).toMatchObject({ userId: USER_IDS.ea, displayName: 'Priya Sandhu', classId: null })
    expect(memberships.find((m) => m.role === 'teacher')?.classId).not.toBeNull()
    expect(memberships.find((m) => m.role === 'parent')).toMatchObject({ classId: null })
  })

  it('refuses everyone but the school administrator of that school', () => {
    const sql = schoolRoom()
    for (const actor of [ACTORS.caseManager, ACTORS.teacher, ACTORS.ea, ACTORS.parentKai, ACTORS.districtLead]) {
      expect(() => runSchool(sql, 'memberships.list', { schoolId: SCHOOL.id }, actor)).toThrow(AltamyraError)
    }
    expect(() => runSchool(sql, 'memberships.list', { schoolId: 'other-school' }, admin)).toThrow(AltamyraError)
  })
})

describe('me.overview', () => {
  it("lists roles, caseload, classes and today's schedule (Monday)", () => {
    const sql = schoolRoom()
    lesson(sql)
    const cm = runSchool<MeResponse>(sql, 'me.overview', { date: '2026-11-02' }, ACTORS.caseManager)
    expect(cm.caseload).toHaveLength(3)
    expect(cm.displayName).toBe('Leila Ahmadi')
    const teacher = runSchool<MeResponse>(sql, 'me.overview', { date: '2026-11-02' }, ACTORS.teacher)
    expect(teacher.todaySchedule).toHaveLength(5)
    expect(teacher.todaySchedule.find((b) => b.classId === CLASS_IDS.literacy)?.lessonTitle).toBe('Salmon life cycle')
    const ea = runSchool<MeResponse>(sql, 'me.overview', { date: '2026-11-02' }, ACTORS.ea)
    expect(ea.todaySchedule.find((b) => b.classId === CLASS_IDS.literacy)?.studentIds.sort()).toEqual([STUDENT_IDS.kai, STUDENT_IDS.sofia].sort())
    expect(ea.todaySchedule.find((b) => b.classId === CLASS_IDS.science)).toBeUndefined()
    expect(runSchool<MeResponse>(sql, 'me.overview', { date: '2026-11-01' }, ACTORS.teacher).todaySchedule).toEqual([])
  })
})
