import { afterEach, describe, expect, it } from 'vitest'
import type { GoalStatusResponse } from '../contract/api'
import type { DataPoint, Goal, IepVersion, Objective, Proposal, ReviewItem } from '../contract/student'
import { CBIEP_SAMPLE_EXPECTED, KAI, STUDENT_IDS, USER_IDS } from '../fixtures'
import { ACTORS, closeAll, countRows, runStudent, studentRoom } from './testing'
import { eventValue } from './measurement'

afterEach(closeAll)

const kai = STUDENT_IDS.kai
const kaiReadingObj = KAI.objectives[0].id
const kaiSelfRegObj = KAI.objectives[1].id
const pendingPhoto = 'd9000000-0000-4000-8000-0000000a1002'
const eaCounter = 'd9000000-0000-4000-8000-0000000a2000'

describe('IEP import and confirmation', () => {
  it('imports a pending version that only takes force once a case manager confirms it', () => {
    const sql = studentRoom()
    expect(() => runStudent(sql, 'iep.import', { studentId: kai, sections: CBIEP_SAMPLE_EXPECTED }, ACTORS.teacher)).toThrow(/propose_only/)
    const imported = runStudent<{ iep: IepVersion; goals: Goal[] }>(sql, 'iep.import', { studentId: kai, sections: CBIEP_SAMPLE_EXPECTED }, ACTORS.caseManager)
    expect(imported.iep).toMatchObject({ version: 1, confirmedAt: null })
    expect(imported.goals).toHaveLength(2)
    expect(sql.get('SELECT 1 AS x FROM iep_versions WHERE confirmed_at IS NOT NULL')).toBeUndefined()

    const confirmed = runStudent<{ iep: IepVersion; goals: Goal[] }>(sql, 'iep.confirm', { studentId: kai, version: 1, expectedVersion: 1 }, ACTORS.caseManager)
    expect(confirmed.iep.confirmedBy).toBe(USER_IDS.caseManager)
    expect(() => runStudent(sql, 'iep.confirm', { studentId: kai, version: 1, expectedVersion: 2 }, ACTORS.caseManager)).toThrow(/already confirmed/)
  })

  it('a newer confirmed version closes the old goals and keeps them', () => {
    const sql = studentRoom('kai')
    const sections = { ...CBIEP_SAMPLE_EXPECTED, goals: [{ area: 'Reading', text: 'Retell a short text with 3 key details' }] }
    runStudent(sql, 'iep.import', { studentId: kai, sections }, ACTORS.caseManager)
    runStudent(sql, 'iep.confirm', { studentId: kai, version: 2, expectedVersion: 1 }, ACTORS.caseManager)
    const goals = sql.all<{ iep_version: number; status: string }>('SELECT iep_version, status FROM goals ORDER BY rowid')
    expect(goals).toEqual([
      { iep_version: 1, status: 'closed' },
      { iep_version: 1, status: 'closed' },
      { iep_version: 2, status: 'active' },
    ])
  })
})

describe('objectives', () => {
  it('case manager confirms; teacher is told to propose', () => {
    const sql = studentRoom('amara')
    const objectiveId = '0b000000-0000-4000-8000-0000000000b1'
    expect(() => runStudent(sql, 'objectives.confirm', { studentId: STUDENT_IDS.amara, objectiveId, expectedVersion: 1 }, ACTORS.teacher)).toThrow(/use objective.propose/)
    const res = runStudent<{ objective: Objective }>(
      sql,
      'objectives.confirm',
      { studentId: STUDENT_IDS.amara, objectiveId, expectedVersion: 1, edits: { target: 5 } },
      ACTORS.caseManager,
    )
    expect(res.objective).toMatchObject({ status: 'confirmed', target: 5, version: 2, confirmedBy: USER_IDS.caseManager })
  })

  it('stores AI proposals once per goal and reports unmeasurable goals', () => {
    const sql = studentRoom()
    const { goals } = runStudent<{ goals: Goal[] }>(sql, 'iep.import', { studentId: kai, sections: CBIEP_SAMPLE_EXPECTED }, ACTORS.caseManager)
    const proposals = [
      { measurable: true, goalId: goals[0].id, metricType: 'accuracy', unit: '% correct', baselineMethod: 'First 3 checks', target: 80, masteryRule: '80% on 3 checks', captureMethod: 'photo' },
      { measurable: false, goalId: goals[1].id, reason: 'No observable behaviour named' },
    ]
    const res = runStudent<{ objectives: Objective[]; unmeasurable: unknown[] }>(sql, 'objectives.propose', { studentId: kai, proposals }, ACTORS.caseManager)
    expect(res.objectives[0]).toMatchObject({ status: 'proposed', reviewDate: '2027-06-15' })
    expect(res.unmeasurable).toEqual([{ goalId: goals[1].id, reason: 'No observable behaviour named' }])
    // PRD 1B: the unmeasurable goal is flagged for the IEP team as a stored row, listed with the objectives.
    expect(res.objectives[1]).toMatchObject({ goalId: goals[1].id, status: 'flagged_unmeasurable', flagReason: 'No observable behaviour named' })
    runStudent(sql, 'objectives.propose', { studentId: kai, proposals }, ACTORS.caseManager)
    expect(countRows(sql, 'objectives')).toBe(2)
    runStudent(sql, 'iep.confirm', { studentId: kai, version: 1, expectedVersion: 1 }, ACTORS.caseManager)
    const listed = runStudent<{ objectives: Objective[] }>(sql, 'objectives.list', { studentId: kai }, ACTORS.caseManager).objectives
    expect(listed.map((o) => o.status)).toEqual(['proposed', 'flagged_unmeasurable'])
    // Confirming it needs a real measure first.
    const flagged = res.objectives[1]
    expect(() => runStudent(sql, 'objectives.confirm', { studentId: kai, objectiveId: flagged.id, expectedVersion: 1 }, ACTORS.caseManager)).toThrow(/unit and mastery rule/)
    const ok = runStudent<{ objective: Objective }>(
      sql,
      'objectives.confirm',
      { studentId: kai, objectiveId: flagged.id, expectedVersion: 1, edits: { metricType: 'frequency', unit: 'times per day', masteryRule: '3 per day for 2 weeks', target: 3 } },
      ACTORS.caseManager,
    )
    expect(ok.objective.status).toBe('confirmed')
  })
})

describe('teacher proposals', () => {
  it('reach the case manager with their evidence and are resolved by the case manager', () => {
    const sql = studentRoom('kai')
    const { proposal } = runStudent<{ proposal: Proposal }>(
      sql,
      'proposals.create',
      { studentId: kai, target: 'iep', change: { goalId: KAI.goals[1].id, newText: 'Use break card 4 times a day' }, evidenceIds: [eaCounter] },
      ACTORS.teacher,
    )
    expect(proposal.evidenceIds).toEqual([eaCounter])
    expect(() => runStudent(sql, 'proposals.create', { studentId: kai, target: 'iep', change: {}, evidenceIds: ['nope'] }, ACTORS.teacher)).toThrow(/evidence/)
    const queue = runStudent<{ proposals: Proposal[] }>(sql, 'proposals.list', { studentId: kai, status: 'open' }, ACTORS.caseManager)
    expect(queue.proposals).toHaveLength(1)
    expect(() => runStudent(sql, 'proposals.resolve', { studentId: kai, proposalId: proposal.id, expectedVersion: 1, decision: 'accepted' }, ACTORS.teacher)).toThrow(/forbidden|propose_only|refused/)
    const resolved = runStudent<{ proposal: Proposal }>(sql, 'proposals.resolve', { studentId: kai, proposalId: proposal.id, expectedVersion: 1, decision: 'accepted', note: 'Will update at review' }, ACTORS.caseManager)
    expect(resolved.proposal).toMatchObject({ status: 'accepted', resolvedBy: USER_IDS.caseManager })
  })
})

describe('evidence capture', () => {
  it('lets a one-tap rating feed accuracy, rate and rubric objectives as a counter', () => {
    for (const metricType of ['accuracy', 'rate', 'rubric'] as const) {
      expect(eventValue({ kind: 'counter', count: 3 }, { metricType } as never)).toBe(3)
    }
    expect(eventValue({ kind: 'counter', count: 0 }, { metricType: 'frequency' } as never)).toBe(0)
    expect(() => eventValue({ kind: 'counter', count: 3 }, { metricType: 'duration' } as never)).toThrow(/cannot feed/)
  })

  it('records EA events with the recorder and a source reference', () => {
    const sql = studentRoom('kai')
    const { dataPoint } = runStudent<{ dataPoint: DataPoint }>(sql, 'events.record', { studentId: kai, event: { kind: 'counter', objectiveId: kaiSelfRegObj, count: 3 } }, ACTORS.ea)
    expect(dataPoint).toMatchObject({ value: 3, source: 'ea', recorderId: USER_IDS.ea, status: 'confirmed' })
    expect(dataPoint.sourceRef).toBe(`ea_event:counter:${dataPoint.id}`)
    expect(() => runStudent(sql, 'events.record', { studentId: kai, event: { kind: 'timer', objectiveId: kaiSelfRegObj, durationSeconds: 30 } }, ACTORS.ea)).toThrow(/cannot feed/)
  })

  it('photo scores land as pending review with a queue item when routed there', () => {
    const sql = studentRoom('kai')
    const res = runStudent<{ dataPoint: DataPoint; reviewItem: ReviewItem | null }>(
      sql,
      'dataPoints.addPending',
      { studentId: kai, objectiveId: kaiReadingObj, value: 66, aiConfidence: 0.4, routing: { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: 'photo:uploads/p1.jpg#q1' },
      ACTORS.teacher,
    )
    expect(res.dataPoint).toMatchObject({ status: 'pending_review', source: 'photo', aiConfidence: 0.4 })
    expect(res.reviewItem?.kind).toBe('low_confidence')
    const auto = runStudent<{ dataPoint: DataPoint; reviewItem: ReviewItem | null }>(
      sql,
      'dataPoints.addPending',
      { studentId: kai, objectiveId: kaiReadingObj, value: 100, aiConfidence: 0.98, routing: { status: 'auto_confirmed' }, sourceRef: 'photo:uploads/p2.jpg#q1' },
      ACTORS.teacher,
    )
    expect(auto).toMatchObject({ dataPoint: { status: 'auto_confirmed' }, reviewItem: null })
    expect(() =>
      runStudent(sql, 'dataPoints.addPending', { studentId: kai, objectiveId: kaiReadingObj, value: 1, aiConfidence: 0.9, routing: { status: 'auto_confirmed' }, sourceRef: '' }, ACTORS.teacher),
    ).toThrow()
  })
})

describe('corrections (PRD: corrections never overwrite)', () => {
  it('create a new version that supersedes the old row, which stays unchanged', () => {
    const sql = studentRoom('kai')
    const before = sql.get<Record<string, unknown>>('SELECT * FROM data_points WHERE id = ?', eaCounter)
    const { dataPoint } = runStudent<{ dataPoint: DataPoint }>(sql, 'dataPoints.correct', { studentId: kai, dataPointId: eaCounter, expectedVersion: 1, value: 2, reason: 'Double-tapped' }, ACTORS.ea)
    expect(dataPoint).toMatchObject({ value: 2, version: 2, supersedesId: eaCounter, reason: 'Double-tapped', recorderId: USER_IDS.ea })
    expect(sql.get('SELECT * FROM data_points WHERE id = ?', eaCounter)).toEqual(before)
    const timeline = runStudent<{ dataPoints: DataPoint[] }>(sql, 'timeline.get', { studentId: kai, objectiveId: kaiSelfRegObj }, ACTORS.caseManager)
    expect(timeline.dataPoints.map((p) => p.id)).toContain(dataPoint.id)
    expect(timeline.dataPoints.map((p) => p.id)).not.toContain(eaCounter)
    // The old row cannot be corrected again: 409.
    expect(() => runStudent(sql, 'dataPoints.correct', { studentId: kai, dataPointId: eaCounter, expectedVersion: 1, value: 5, reason: 'x' }, ACTORS.caseManager)).toThrow(/already been corrected/)
  })

  it('EAs correct only their own entries', () => {
    const sql = studentRoom('kai')
    expect(() => runStudent(sql, 'dataPoints.correct', { studentId: kai, dataPointId: pendingPhoto, expectedVersion: 1, value: 50, reason: 'Misread' }, ACTORS.ea)).toThrow(/not_own_entry/)
  })

  it('review confirm with a new value corrects; without one confirms the status', () => {
    const sql = studentRoom('kai')
    runStudent(sql, 'dataPoints.addPending', { studentId: kai, objectiveId: kaiReadingObj, value: 66, aiConfidence: 0.4, routing: { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: 'photo:a.jpg#q1' }, ACTORS.teacher)
    runStudent(sql, 'dataPoints.addPending', { studentId: kai, objectiveId: kaiReadingObj, value: 70, aiConfidence: 0.95, routing: { status: 'pending_review', reviewKind: 'sampled' }, sourceRef: 'photo:b.jpg#q1' }, ACTORS.teacher)
    const { items } = runStudent<{ items: { item: ReviewItem; dataPoint: DataPoint }[] }>(sql, 'review.list', { studentId: kai }, ACTORS.teacher)
    expect(items).toHaveLength(2)
    expect(runStudent<{ items: unknown[] }>(sql, 'review.list', { studentId: kai }, ACTORS.ea).items).toHaveLength(0)

    const corrected = runStudent<{ dataPoint: DataPoint }>(sql, 'review.confirm', { studentId: kai, reviewId: items[0].item.id, expectedVersion: 1, value: 33 }, ACTORS.teacher)
    expect(corrected.dataPoint).toMatchObject({ value: 33, supersedesId: items[0].dataPoint.id, status: 'confirmed' })
    const confirmed = runStudent<{ dataPoint: DataPoint }>(sql, 'review.confirm', { studentId: kai, reviewId: items[1].item.id, expectedVersion: 1 }, ACTORS.teacher)
    expect(confirmed.dataPoint).toMatchObject({ id: items[1].dataPoint.id, status: 'confirmed', version: 2 })
    expect(runStudent<{ items: unknown[] }>(sql, 'review.list', { studentId: kai }, ACTORS.teacher).items).toHaveLength(0)
  })
})

describe('timeline and goal status', () => {
  it('parent queries never return pending data', () => {
    const sql = studentRoom('kai')
    const all = runStudent<{ dataPoints: DataPoint[] }>(sql, 'timeline.get', { studentId: kai }, ACTORS.caseManager)
    expect(all.dataPoints.some((p) => p.status === 'pending_review')).toBe(true)
    const parent = runStudent<{ dataPoints: DataPoint[]; decisions: unknown[] }>(sql, 'timeline.get', { studentId: kai }, ACTORS.parentKai)
    expect(parent.dataPoints.length).toBeGreaterThan(0)
    expect(parent.dataPoints.every((p) => p.status === 'confirmed' || p.status === 'auto_confirmed')).toBe(true)
    expect(parent.decisions).toEqual([])
    expect(() => runStudent(sql, 'dataPoint.source', { studentId: kai, dataPointId: pendingPhoto }, ACTORS.parentKai)).toThrow(/not found/)
  })

  it('EAs see today only', () => {
    const sql = studentRoom('kai')
    const res = runStudent<{ dataPoints: DataPoint[] }>(sql, 'timeline.get', { studentId: kai, now: '2026-10-21T22:00:00.000Z' }, ACTORS.ea)
    expect(res.dataPoints.map((p) => p.recordedAt.slice(0, 10))).toEqual(['2026-10-21'])
  })

  it('goal status uses confirmed points and opens each point source', () => {
    const sql = studentRoom('kai')
    const status = runStudent<GoalStatusResponse>(sql, 'goal.status', { studentId: kai, goalId: KAI.goals[1].id, now: '2026-10-22T00:00:00.000Z' }, ACTORS.teacher)
    expect(status).toMatchObject({ objectiveId: kaiSelfRegObj, baseline: 1, current: 3, target: 4, canShowTrend: true })
    expect(status.trend).toBeGreaterThan(0)
    const src = runStudent<{ source: unknown }>(sql, 'dataPoint.source', { studentId: kai, dataPointId: 'd9000000-0000-4000-8000-0000000a1001' }, ACTORS.teacher)
    expect(src.source).toEqual({ kind: 'photo', fileKey: 'fixtures/sheet-kai-1.jpg', itemId: 'item-1' })
  })

  it('every write appends to the audit log in the same transaction', () => {
    const sql = studentRoom('kai')
    const before = countRows(sql, 'audit_log')
    runStudent(sql, 'events.record', { studentId: kai, event: { kind: 'counter', objectiveId: kaiSelfRegObj, count: 1 } }, ACTORS.teacher)
    expect(countRows(sql, 'audit_log')).toBe(before + 1)
    expect(() => sql.run('DELETE FROM audit_log')).toThrow(/append-only/)
  })
})
