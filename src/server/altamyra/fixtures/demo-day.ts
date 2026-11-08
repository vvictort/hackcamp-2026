import { z } from 'zod'
import { defineOp, type SqlExecutor } from '../contract/ops'
import { appendAudit } from '../db/audit'
import { insertEntity, newId, nowIso } from '../repos/base'
import { DEMO_PARENT, DEMO_STUDENT } from './demo-iep-sd23'
import { CLASS_IDS, USER_IDS } from './school'

/**
 * Dev only (reached through POST /dev/demo-day, which 404s unless ALTAMYRA_DEV_SEED is "true").
 * Adds one new fictional student to the demo school, with the staff and the parent who work with them:
 * the case manager and the EA of the fixture school, the teacher through the literacy and science rosters,
 * and a new fictional parent. The student's name and IEP arrive later through the normal CB-IEP import.
 */

const ACTOR = 'system:demo-day'

export const devDemoStudent = defineOp({
  name: 'dev.demoStudent',
  room: 'school',
  args: z.object({ studentId: z.string().uuid(), displayToken: z.string().min(1), now: z.string().optional() }),
  run(sql: SqlExecutor, args) {
    const at = nowIso(args.now)
    const create = (table: string, value: object) => insertEntity(sql, table, value)
    // One demo-day student at a time: remove the school rows of any earlier run (found by the fictional parent's link),
    // so pressing the button again replaces Simi instead of adding a second one.
    const earlier = sql.all<{ student_id: string }>('SELECT student_id FROM parent_links WHERE parent_user_id = ?', DEMO_PARENT.id).map((r) => r.student_id)
    for (const id of earlier) {
      for (const table of ['sheet_codes', 'lesson_plans', 'iep_change_tickets', 'roster', 'memberships', 'parent_links']) sql.run(`DELETE FROM ${table} WHERE student_id = ?`, id)
      sql.run('DELETE FROM students WHERE id = ?', id)
      appendAudit(sql, { actorId: ACTOR, action: 'demo.student.replaced', tableName: 'students', rowId: id, at })
    }
    create('students', { id: args.studentId, displayToken: args.displayToken, grade: DEMO_STUDENT.grade, createdAt: at, version: 1 })
    if (!sql.get('SELECT 1 FROM users WHERE id = ?', DEMO_PARENT.id)) create('users', { id: DEMO_PARENT.id, displayName: DEMO_PARENT.displayName, createdAt: at })
    const member = (userId: string, role: 'case_manager' | 'ea') =>
      create('memberships', { id: newId(), userId, role, studentId: args.studentId, classId: null, districtId: null, createdAt: at, version: 1 })
    member(USER_IDS.caseManager, 'case_manager')
    member(USER_IDS.ea, 'ea')
    create('parent_links', { id: newId(), parentUserId: DEMO_PARENT.id, studentId: args.studentId, createdAt: at })
    for (const classId of [CLASS_IDS.literacy, CLASS_IDS.science]) create('roster', { classId, studentId: args.studentId })
    appendAudit(sql, { actorId: ACTOR, action: 'demo.student', tableName: 'students', rowId: args.studentId, at })
    return { studentId: args.studentId }
  },
})
