import { afterEach, describe, expect, it } from 'vitest'
import type { MeResponse } from '../contract/api'
import { AltamiraError } from '../contract/errors'
import { userActor } from '../contract/permissions'
import type { Lesson, LessonAnalysis, SheetCode, ShareToken } from '../contract/school'
import { CLASS_IDS, FIXTURE_NAMES, SCHOOL, STUDENT_IDS, USER_IDS } from '../fixtures'
import { ACTORS, closeAll, countRows, runSchool, schoolRoom } from './testing'
import { hashToken, newToken } from './tokens'

afterEach(closeAll)

const admin = userActor(USER_IDS.schoolAdmin, { schoolAdminOf: [SCHOOL.id] })
const analysis = { objectives: ['Describe the salmon life cycle'], readingLevel: 'grade 4', writingLoad: 'medium', modality: ['text'], competencies: ['Communicating'] }

function lesson(sql = schoolRoom()) {
  const { lesson } = runSchool<{ lesson: Lesson }>(
    sql,
    'lessons.create',
    { classId: CLASS_IDS.literacy, title: 'Salmon life cycle', sourceKind: 'text', text: 'Salmon hatch in rivers.', scheduledFor: '2026-11-02' },
    ACTORS.teacher,
  )
  return { sql, lesson }
}

describe('dev.seed and actor.load', () => {
  it('seeds an empty school room once', () => {
    const sql = schoolRoom(false)
    const res = runSchool<{ schoolId: string; studentIds: string[] }>(sql, 'dev.seed', {}, ACTORS.system)
    expect(res.schoolId).toBe(SCHOOL.id)
    expect(res.studentIds).toHaveLength(3)
    expect(() => runSchool(sql, 'dev.seed', {}, ACTORS.system)).toThrow(/already seeded/)
  })

  it('builds actor roles from memberships; teachers get their roster students', () => {
    const sql = schoolRoom()
    const teacher = runSchool<{ studentRoles: Record<string, string[]>; classIds: string[] }>(sql, 'actor.load', { userId: USER_IDS.teacher, schoolId: SCHOOL.id }, ACTORS.system)
    expect(Object.keys(teacher.studentRoles).sort()).toEqual(Object.values(STUDENT_IDS).sort())
    expect(teacher.classIds).toHaveLength(5)
    const ea = runSchool<{ studentRoles: Record<string, string[]> }>(sql, 'actor.load', { userId: USER_IDS.ea, schoolId: SCHOOL.id }, ACTORS.system)
    expect(ea.studentRoles).toEqual({ [STUDENT_IDS.kai]: ['ea'], [STUDENT_IDS.sofia]: ['ea'] })
    const parent = runSchool<{ parentOf: string[] }>(sql, 'actor.load', { userId: USER_IDS.parentAmara, schoolId: SCHOOL.id }, ACTORS.system)
    expect(parent.parentOf).toEqual([STUDENT_IDS.amara])
    const adminParts = runSchool<{ schoolAdminOf: string[] }>(sql, 'actor.load', { userId: USER_IDS.schoolAdmin, schoolId: SCHOOL.id }, ACTORS.system)
    expect(adminParts.schoolAdminOf).toEqual([SCHOOL.id])
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

describe('lessons and the cached analysis (PRD 1A-2)', () => {
  it('teachers create lessons; EAs cannot', () => {
    const { sql, lesson: l } = lesson()
    expect(l.createdBy).toBe(USER_IDS.teacher)
    expect(() => runSchool(sql, 'lessons.create', { classId: CLASS_IDS.literacy, title: 'x', sourceKind: 'text', text: 'y' }, ACTORS.ea)).toThrow(/lesson.augment/)
    expect(runSchool<{ subject: string }>(sql, 'lessons.get', { lessonId: l.id }, ACTORS.ea).subject).toBe('literacy')
  })

  it('keeps exactly one analysis per lesson', () => {
    const { sql, lesson: l } = lesson()
    const first = runSchool<{ analysis: LessonAnalysis; cached: boolean }>(sql, 'lessons.saveAnalysis', { lessonId: l.id, analysis, provider: 'fixture' }, ACTORS.teacher)
    const second = runSchool<{ analysis: LessonAnalysis; cached: boolean }>(sql, 'lessons.saveAnalysis', { lessonId: l.id, analysis: { ...analysis, readingLevel: 'grade 9' }, provider: 'fixture' }, ACTORS.teacher)
    expect(first.cached).toBe(false)
    expect(second).toEqual({ analysis: first.analysis, cached: true })
    expect(countRows(sql, 'lesson_analyses')).toBe(1)
    expect(runSchool<{ analysis: LessonAnalysis }>(sql, 'lessons.getAnalysis', { lessonId: l.id }, ACTORS.teacher).analysis.id).toBe(first.analysis.id)
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

describe('share tokens', () => {
  it('stores only the hash, resolves until expiry, then answers 410', async () => {
    const sql = schoolRoom()
    const token = newToken()
    const tokenHash = await hashToken(token)
    expect(tokenHash).toHaveLength(64)
    const { shareToken } = runSchool<{ shareToken: ShareToken }>(
      sql,
      'shareTokens.create',
      { kind: 'today_view', studentId: STUDENT_IDS.kai, tokenHash, ttlHours: 2, now: '2026-11-02T08:00:00.000Z' },
      ACTORS.teacher,
    )
    expect(shareToken.expiresAt).toBe('2026-11-02T10:00:00.000Z')
    expect(JSON.stringify(sql.all('SELECT * FROM share_tokens'))).not.toContain(token)
    expect(runSchool<{ studentId: string }>(sql, 'shareTokens.resolve', { tokenHash, now: '2026-11-02T09:00:00.000Z' }, ACTORS.system).studentId).toBe(STUDENT_IDS.kai)
    try {
      runSchool(sql, 'shareTokens.resolve', { tokenHash, now: '2026-11-02T10:00:00.000Z' }, ACTORS.system)
      expect.unreachable()
    } catch (e) {
      expect((e as AltamiraError).status).toBe(410)
    }
    expect(runSchool<{ expired: string[] }>(sql, 'shareTokens.expire', { now: '2026-11-03T00:00:00.000Z' }, ACTORS.system).expired).toEqual([shareToken.id])
  })

  it('only case managers and teachers create Today View links', async () => {
    const sql = schoolRoom()
    const tokenHash = await hashToken(newToken())
    expect(() => runSchool(sql, 'shareTokens.create', { kind: 'today_view', studentId: STUDENT_IDS.kai, tokenHash }, ACTORS.ea)).toThrow(AltamiraError)
    const session = runSchool<{ shareToken: ShareToken }>(sql, 'shareTokens.create', { kind: 'student_session', studentId: STUDENT_IDS.kai, tokenHash, now: '2026-11-02T08:00:00.000Z' }, ACTORS.ea)
    expect(session.shareToken.expiresAt).toBe('2026-11-02T08:30:00.000Z')
  })

  it('a revoked link answers 410', async () => {
    const sql = schoolRoom()
    const tokenHash = await hashToken(newToken())
    const { shareToken } = runSchool<{ shareToken: ShareToken }>(sql, 'shareTokens.create', { kind: 'today_view', studentId: STUDENT_IDS.kai, tokenHash }, ACTORS.teacher)
    runSchool(sql, 'shareTokens.expire', { id: shareToken.id }, ACTORS.teacher)
    expect(() => runSchool(sql, 'shareTokens.resolve', { tokenHash }, ACTORS.system)).toThrow(/expired/)
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
