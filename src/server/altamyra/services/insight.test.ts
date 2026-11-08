import { afterEach, describe, expect, it } from 'vitest'
import { KAI, STUDENT_IDS } from '../fixtures'
import { ACTORS, closeAll, runStudent, studentRoom } from './testing'

afterEach(closeAll)

const kai = STUDENT_IDS.kai
const selfRegGoal = KAI.goals[1].id

describe('data needed scan (PRD 1B, principle 6)', () => {
  it('schedules a check, waits for it, and alerts the case manager only after 2 failed attempts', () => {
    const sql = studentRoom('kai')
    const now = (d: number) => new Date(Date.parse('2026-11-01T12:00:00.000Z') + (d - 1) * 86_400_000).toISOString()
    type Scan = { scheduled: string[]; probes: string[]; alerted: string[] }
    const scan = (d: number) => runStudent<Scan>(sql, 'dataNeeded.scan', { studentId: kai, now: now(d) }, ACTORS.system)
    expect(scan(7).scheduled).toHaveLength(4)
    // The first attempt is still open: daily scans do not count as attempts.
    expect(scan(8)).toEqual({ scheduled: [], probes: [], alerted: [] })
    // One school week without data: attempt 1 failed, attempt 2 is scheduled.
    expect(scan(14).scheduled).toHaveLength(4)
    expect(scan(20).alerted).toEqual([])
    const alert = scan(21)
    expect(alert.scheduled).toEqual([])
    expect(alert.alerted).toHaveLength(4)
    expect(scan(22).alerted).toEqual([])
    expect(sql.all<{ rule: string }>('SELECT rule FROM decisions').every((d) => d.rule === 'data_needed')).toBe(true)
  })

  it('data-needed rule schedules a check: a probe copied from the objective\'s keyed check', () => {
    const sql = studentRoom('kai')
    const objective = KAI.objectives[0]
    const items = [{ id: 'q1', prompt: 'Which card asks for a break?', format: 'multiple_choice', options: ['Break', 'Lunch'] }]
    sql.run(
      `INSERT INTO lens_runs (id, lesson_id, analysis_id, created_by, created_at) VALUES ('1e000000-0000-4000-8000-000000000001', '1e550000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'u', '2026-10-01T00:00:00.000Z')`,
    )
    sql.run(
      `INSERT INTO suggestions (id, lens_run_id, kind, gap_type, goal_ids_json, content_json, status, created_at) VALUES ('5a000000-0000-4000-8000-000000000001', '1e000000-0000-4000-8000-000000000001', 'gap', 'access', '[]', '{"title":"t","why":"w","accommodation":null}', 'draft', '2026-10-01T00:00:00.000Z')`,
    )
    sql.run(
      `INSERT INTO checks (id, suggestion_id, objective_id, items_json, answer_key_json, status) VALUES ('c4000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', ?, ?, '[{"itemId":"q1","accepted":["Break"]}]', 'active')`,
      objective.id,
      JSON.stringify(items),
    )
    const res = runStudent<{ scheduled: string[]; probes: string[] }>(sql, 'dataNeeded.scan', { studentId: kai, now: '2026-11-07T12:00:00.000Z' }, ACTORS.system)
    expect(res.scheduled).toContain(objective.id)
    expect(res.probes).toHaveLength(1)
    const probe = sql.get<{ objective_id: string; form_json: string }>('SELECT objective_id, form_json FROM probes WHERE id = ?', res.probes[0])
    expect(probe?.objective_id).toBe(objective.id)
    expect(JSON.parse(probe!.form_json).items).toEqual(items)
  })

  it('skips goals with 2 points in the last 2 weeks', () => {
    const sql = studentRoom('kai')
    const res = runStudent<{ scheduled: string[] }>(sql, 'dataNeeded.scan', { studentId: kai, now: '2026-10-22T00:00:00.000Z' }, ACTORS.system)
    expect(res.scheduled).toEqual([KAI.objectives[0].id])
  })
})

describe('proficiency (PRD principle 7)', () => {
  it('the teacher sets it; an EA cannot', () => {
    const sql = studentRoom('kai')
    const res = runStudent<{ rating: { level: string; setBy: string } }>(sql, 'proficiency.set', { studentId: kai, goalId: selfRegGoal, level: 'Proficient', period: 'T1' }, ACTORS.teacher)
    expect(res.rating).toMatchObject({ level: 'Proficient', setBy: ACTORS.teacher.userId })
    expect(() => runStudent(sql, 'proficiency.set', { studentId: kai, goalId: selfRegGoal, level: 'Proficient', period: 'T1' }, ACTORS.ea)).toThrow(/not_permitted/)
  })

})

describe('aimline and what works', () => {
  it('aimline runs to the target at the IEP review date', () => {
    const sql = studentRoom('kai')
    const res = runStudent<{ start: { value: number }; end: { date: string; value: number }; points: unknown[] }>(sql, 'aimline.get', { studentId: kai, goalId: selfRegGoal }, ACTORS.teacher)
    expect(res.start.value).toBe(1)
    expect(res.end).toEqual({ date: '2027-06-15', value: 4 })
    expect(res.points).toHaveLength(7)
  })

  it('what works is empty until adaptations have outcomes', () => {
    const sql = studentRoom('kai')
    expect(runStudent<{ rows: unknown[] }>(sql, 'whatWorks.get', { studentId: kai }, ACTORS.ea).rows).toEqual([])
  })
})

describe('removed insight features', () => {
  it('have no digest, decision job or draft ops', () => {
    const sql = studentRoom('kai')
    for (const op of ['digest.weekly', 'decisions.evaluate', 'drafts.save', 'drafts.update', 'drafts.markUsed', 'drafts.context', 'drafts.get']) {
      expect(() => runStudent(sql, op, { studentId: kai }, ACTORS.caseManager)).toThrow(/no op/)
    }
  })
})
