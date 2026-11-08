import { afterEach, describe, expect, it } from 'vitest'
import type { LensStudentResult } from '../contract/api'
import type { LensAdaptation, LensCheck } from '../contract/ai'
import { userActor } from '../contract/permissions'
import type { SqlExecutor } from '../contract/ops'
import { KAI, SOFIA, STUDENT_IDS } from '../fixtures'
import { ACTORS, closeAll, countRows, runStudent, studentRoom } from '../e2e/testing'

afterEach(closeAll)

const LESSON = '1e550000-0000-4000-8000-000000000001'
const ANALYSIS = 'a0000000-0000-4000-8000-000000000001'

type Labelled = LensAdaptation & { label: 'adaptation' | 'modification' }

const adaptation = (goalId: string, over: Partial<Labelled> = {}): Labelled => ({
  adaptationType: 'chunked_steps',
  title: 'Chunked steps',
  text: 'Do the task in three short steps.',
  why: 'Instructions one step at a time',
  goalIds: [goalId],
  changesOutcome: false,
  modelLabel: 'adaptation',
  label: 'adaptation',
  ...over,
})

const check = (goalId: string, objectiveId: string): LensCheck => ({
  goalId,
  objectiveId,
  items: [{ id: 'q1', prompt: 'What is 7 + 5?', format: 'numeric', options: null }],
  answerKey: [{ itemId: 'q1', accepted: ['12'] }],
  rubric: null,
})

function saveRun(sql: SqlExecutor, studentId: string, subject: string, adaptations: ReturnType<typeof adaptation>[], checks: LensCheck[] = []) {
  return runStudent<LensStudentResult>(
    sql,
    'lens.saveRun',
    {
      studentId,
      lessonId: LESSON,
      analysisId: ANALYSIS,
      subject,
      gaps: [{ gapType: 'access', title: 'Text above reading level', why: 'Read-aloud support', goalIds: [], accommodation: 'Read-aloud' }],
      adaptations,
      checks,
    },
    ACTORS.teacher,
  )
}

const kaiGoal = KAI.goals[0].id
const kaiObjective = KAI.objectives[0].id
const sofiaMathGoal = SOFIA.goals[0].id

describe('lens.saveRun and the guardrail (PRD 1A-5)', () => {
  it('labels any outcome change as modification and blocks it when the IEP does not authorize the subject', () => {
    const sql = studentRoom('kai')
    const result = saveRun(sql, STUDENT_IDS.kai, 'math', [
      adaptation(kaiGoal),
      // The model claims "adaptation"; code decides.
      adaptation(kaiGoal, { adaptationType: 'modified_assessment', changesOutcome: true, modelLabel: 'adaptation', label: 'adaptation' }),
    ])
    const [gap, plain, changed] = result.suggestions
    expect(gap.kind).toBe('gap')
    expect(plain).toMatchObject({ kind: 'adaptation', label: 'adaptation', status: 'draft' })
    expect(changed).toMatchObject({ kind: 'adaptation', label: 'modification', status: 'blocked' })
  })

  it('stores an authorized modification as a draft (Sofía, math)', () => {
    const sql = studentRoom('sofia')
    const result = saveRun(sql, STUDENT_IDS.sofia, 'math', [adaptation(sofiaMathGoal, { changesOutcome: true, label: 'modification' })])
    expect(result.suggestions[1]).toMatchObject({ label: 'modification', status: 'draft' })
  })

  it('attaches embedded checks to the adaptation for their goal (PRD 1A-6)', () => {
    const sql = studentRoom('kai')
    const result = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(kaiGoal)], [check(kaiGoal, kaiObjective)])
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].suggestionId).toBe(result.suggestions[1].id)
    expect(countRows(sql, 'audit_log')).toBeGreaterThan(1)
  })
})

describe('goal tags (PRD 1A-3, 1A-4)', () => {
  it('drops goal ids that are not current goals of this student, and adaptations left untagged', () => {
    const sql = studentRoom('kai')
    const foreign = SOFIA.goals[0].id
    const result = saveRun(sql, STUDENT_IDS.kai, 'literacy', [adaptation(foreign), adaptation(kaiGoal, { goalIds: [kaiGoal, foreign] })])
    const adaptations = result.suggestions.filter((s) => s.kind === 'adaptation')
    expect(adaptations).toHaveLength(1)
    expect(adaptations[0].goalIds).toEqual([kaiGoal])
  })

  it('a gap must name a goal or an accommodation', () => {
    const sql = studentRoom('kai')
    const bad = { studentId: STUDENT_IDS.kai, lessonId: LESSON, analysisId: ANALYSIS, subject: 'literacy', adaptations: [], checks: [] }
    expect(() =>
      runStudent(sql, 'lens.saveRun', { ...bad, gaps: [{ gapType: 'access', title: 'x', why: 'y', goalIds: [], accommodation: null }] }, ACTORS.teacher),
    ).toThrow(/goal or accommodation/)
  })
})

describe('profile.get', () => {
  it('the profile is the full read-only IEP for the EA of the student, and refused for an unassigned EA', () => {
    const sql = studentRoom('kai')
    const ea = runStudent<Record<string, unknown>>(sql, 'profile.get', { studentId: STUDENT_IDS.kai, displayToken: 'S-K7Q4', grade: '4' }, ACTORS.ea)
    expect(ea.view).toBe('full')
    expect(JSON.stringify(ea)).toContain(KAI.goals[0].text)
    expect(() => runStudent(sql, 'profile.get', { studentId: STUDENT_IDS.kai, displayToken: 'S-K7Q4', grade: '4' }, userActor('other-ea', { studentRoles: { [STUDENT_IDS.amara]: ['ea'] } }))).toThrow(/not_in_scope/)
    const cm = runStudent<Record<string, unknown>>(sql, 'profile.get', { studentId: STUDENT_IDS.kai, displayToken: 'S-K7Q4', grade: '4' }, ACTORS.caseManager)
    expect(cm.view).toBe('full')
  })
})
