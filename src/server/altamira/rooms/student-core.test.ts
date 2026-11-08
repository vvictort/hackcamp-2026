import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADAPTATION_TYPES } from '../contract/enums'
import { appendAudit } from '../db/audit'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateStudent } from '../db/schema/student'
import { AMARA, KAI, seedStudent } from '../fixtures'
import { USER_IDS } from '../fixtures/school'
import { auditMark } from './core'
import { CBIEP_SAMPLE_EXPECTED } from '../fixtures'
import { ACTORS, runStudent } from '../services/testing'
import { confirmedDataPointsSince, counterDimensions, hasActiveConsent, insightIncrements, liveMessage, reviewTimelinessSince } from './student-core'

type Sql = ReturnType<typeof createNodeSqlExecutor>

const pending = KAI.dataPoints.find((d) => d.status === 'pending_review')!
const confirmed = KAI.dataPoints.find((d) => d.status === 'confirmed')!

function confirm(sql: Sql, id: string) {
  sql.transaction(() => {
    sql.run("UPDATE data_points SET status = 'confirmed', version = version + 1 WHERE id = ?", id)
    appendAudit(sql, {
      actorId: USER_IDS.caseManager,
      action: 'review.confirm',
      tableName: 'data_points',
      rowId: id,
      before: { status: 'pending_review' },
      after: { status: 'confirmed' },
    })
  })
}

describe('student room core', () => {
  let sql: Sql
  beforeEach(() => {
    sql = createNodeSqlExecutor()
    migrateStudent(sql)
    seedStudent(sql, KAI)
  })
  afterEach(() => sql.close())

  it('finds a data point confirmed after the mark', () => {
    const mark = auditMark(sql)
    confirm(sql, pending.id)
    expect(confirmedDataPointsSince(sql, mark)).toEqual([pending.id])
  })

  it('ignores audit rows from before the mark and points still pending', () => {
    const mark = auditMark(sql)
    expect(confirmedDataPointsSince(sql, mark)).toEqual([])
    appendAudit(sql, { actorId: USER_IDS.ea, action: 'note', tableName: 'data_points', rowId: pending.id })
    expect(confirmedDataPointsSince(sql, mark)).toEqual([])
  })

  it('does not count a point twice when it is audited again after confirmation', () => {
    confirm(sql, pending.id)
    const mark = auditMark(sql)
    appendAudit(sql, {
      actorId: USER_IDS.caseManager,
      action: 'touch',
      tableName: 'data_points',
      rowId: pending.id,
      after: { status: 'confirmed' },
    })
    expect(confirmedDataPointsSince(sql, mark)).toEqual([])
  })

  it('does not count a correction of an already confirmed point', () => {
    const mark = auditMark(sql)
    sql.run(
      `INSERT INTO data_points (id, objective_id, value, unit, source, recorder_id, recorded_at, status, supersedes_id, reason)
       SELECT 'corr-1', objective_id, value + 1, unit, source, recorder_id, recorded_at, 'confirmed', id, 'typo' FROM data_points WHERE id = ?`,
      confirmed.id,
    )
    appendAudit(sql, { actorId: USER_IDS.caseManager, action: 'correct', tableName: 'data_points', rowId: 'corr-1', after: { status: 'confirmed' } })
    expect(confirmedDataPointsSince(sql, mark)).toEqual([])
  })

  it('builds de-identified counter dimensions with goal area, proficiency, label and month', () => {
    const [dims] = counterDimensions(sql, [confirmed.id])
    const objective = KAI.objectives.find((o) => o.id === confirmed.objectiveId)!
    const goal = KAI.goals.find((g) => g.id === objective.goalId)!
    const rating = KAI.proficiency.find((p) => p.goalId === goal.id)
    expect(dims).toEqual({
      goalArea: goal.area,
      proficiencyLevel: rating?.level ?? null,
      label: null,
      goalProgress: objective.status === 'confirmed' ? expect.any(String) : null,
      period: confirmed.recordedAt.slice(0, 7),
    })
    const text = JSON.stringify(dims)
    expect(text).not.toContain(KAI.studentId)
    expect(text).not.toContain('Kai')
  })

  it('labels a point by its active supports: modification wins over adaptation', () => {
    sql.run("INSERT INTO lens_runs (id, lesson_id, analysis_id, created_by, created_at) VALUES ('lr1', 'l1', 'a1', 'u', '2026-09-01')")
    for (const [id, label] of [['s-ad', 'adaptation'], ['s-mod', 'modification']]) {
      sql.run(
        "INSERT INTO suggestions (id, lens_run_id, kind, adaptation_type, label, content_json, created_at) VALUES (?, 'lr1', 'adaptation', ?, ?, '{}', '2026-09-01')",
        id,
        ADAPTATION_TYPES[0],
        label,
      )
    }
    sql.run("UPDATE data_points SET active_adaptations_json = '[\"s-ad\"]' WHERE id = ?", confirmed.id)
    expect(counterDimensions(sql, [confirmed.id])[0].label).toBe('adaptation')
    sql.run("UPDATE data_points SET active_adaptations_json = '[\"s-ad\",\"s-mod\"]' WHERE id = ?", confirmed.id)
    expect(counterDimensions(sql, [confirmed.id])[0].label).toBe('modification')
  })

  it('checks for an active, unrevoked consent', () => {
    const kinds = new Set(KAI.consents.filter((c) => c.revokedAt === null).map((c) => c.kind))
    expect(hasActiveConsent(sql, 'video')).toBe(kinds.has('video'))
    expect(hasActiveConsent(sql, 'voice_note')).toBe(kinds.has('voice_note'))
    sql.run('UPDATE consents SET revoked_at = ?', '2026-11-01T00:00:00.000Z')
    expect(hasActiveConsent(sql, 'video')).toBe(false)
  })

  it('Amara has no consents', () => {
    const other = createNodeSqlExecutor()
    migrateStudent(other)
    seedStudent(other, AMARA)
    expect(hasActiveConsent(other, 'video')).toBe(false)
    expect(hasActiveConsent(other, 'voice_note')).toBe(false)
    other.close()
  })

  it('records review timeliness when a new IEP version is confirmed (PRD District Insights)', () => {
    const due = KAI.iep.sections.reviewDate
    const reimport = (now: string) => {
      const { iep } = runStudent<{ iep: { version: number; rowVersion: number } }>(sql, 'iep.import', { studentId: KAI.studentId, sections: CBIEP_SAMPLE_EXPECTED, now }, ACTORS.caseManager)
      const mark = auditMark(sql)
      runStudent(sql, 'iep.confirm', { studentId: KAI.studentId, version: iep.version, expectedVersion: iep.rowVersion, now }, ACTORS.caseManager)
      return mark
    }
    expect(due).not.toBeNull()
    const onTime = reimport(`${due}T12:00:00.000Z`)
    expect(reviewTimelinessSince(sql, onTime)).toEqual([{ period: due!.slice(0, 7), reviewTimeliness: 'on_time' }])
    // The sample's own review date has passed by 2028: late.
    const late = reimport('2028-01-10T12:00:00.000Z')
    expect(insightIncrements(sql, late, [])).toEqual([
      { period: '2028-01', goalArea: null, proficiencyLevel: null, label: null, goalProgress: null, reviewTimeliness: 'late', by: 1 },
    ])
  })

  it('live messages carry ids only', () => {
    expect(liveMessage(['dp1'])).toEqual({ type: 'timeline.updated', dataPointIds: ['dp1'] })
  })
})
