import { z } from 'zod'
import { Id } from '../contract/common'
import { Proficiency } from '../contract/enums'
import { AltamyraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import type { Decision, Objective, Probe, ProficiencyRating } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { audit, insertEntity, newId, nowIso } from '../repos/base'
import * as ev from '../repos/evidence'
import { confirmedObjectiveForGoal, currentConfirmedObjectives, goalById } from '../repos/iep'
import { latestKeyedCheck } from '../repos/lens'
import { aimline, dataNeeded, suggestProficiency, type ProficiencySuggestion, type WhatWorksRow } from './analytics'
import { Now, StudentArgs, authorize } from './authz'
import { whatWorksFor } from './student-common'
import { DATA_NEEDED_ATTEMPT_DAYS, RATE_PROBE_SECONDS, daysToMs } from './thresholds'

/** Insight ops: aimline, what works, data needed, proficiency. */

function requireGoal(sql: SqlExecutor, goalId: string) {
  const goal = goalById(sql, goalId)
  if (!goal) throw new AltamyraError('not_found', `goal ${goalId} not found`)
  return goal
}

// ---------- aimline and what works ----------

export const aimlineGet = defineOp({
  name: 'aimline.get',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ goalId: Id }).extend(Now.shape),
  run(sql, args, actor) {
    authorize(actor, 'progress.view', args.studentId)
    const objective = confirmedObjectiveForGoal(sql, requireGoal(sql, args.goalId).id)
    if (!objective) return { start: null, end: null, points: [] }
    const confirmed = ev.headDataPoints(sql, { objectiveId: objective.id, confirmedOnly: true })
    const line = aimline(ev.toPoints(confirmed), objective, objective.confirmedAt ?? undefined)
    return {
      start: line?.start ?? null,
      end: line?.end ?? null,
      points: confirmed.filter((p) => p.source !== 'teacher').map((p) => ({ id: p.id, date: p.recordedAt, value: p.value })),
    }
  },
})

export const whatWorksGet = defineOp({
  name: 'whatWorks.get',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs,
  run(sql, args, actor): { rows: WhatWorksRow[] } {
    authorize(actor, 'progress.view', args.studentId)
    return { rows: whatWorksFor(sql) }
  },
})

// ---------- decisions ----------

function insertDecision(sql: SqlExecutor, actor: Actor, objective: Objective, rule: Decision['rule'], at: string): Decision {
  const decision: Decision = { id: newId(), objectiveId: objective.id, rule, firedAt: at, response: null, respondedBy: null, version: 1 }
  insertEntity(sql, 'decisions', decision)
  audit(sql, actor, 'decisions.fire', 'decisions', decision.id, undefined, decision, at)
  return decision
}

// ---------- data needed (PRD 1B, principle 6) ----------

const DATA_NEEDED_ACTION = 'dataNeeded.schedule'

/**
 * Places an equivalent probe form for the objective (PRD 1B "Scheduled
 * probes"), copied from its latest keyed check. Student mode delivers probes
 * before other items. Null when the objective has no keyed check to copy.
 */
function scheduleProbe(sql: SqlExecutor, actor: Actor, objective: Objective, at: string): Probe | null {
  const check = latestKeyedCheck(sql, objective.id)
  if (!check?.answerKey) return null
  const probe: Probe = {
    id: newId(),
    objectiveId: objective.id,
    skill: goalById(sql, objective.goalId)?.area ?? objective.unit,
    level: 'current',
    form: { items: check.items, answerKey: check.answerKey, timeLimitSeconds: objective.metricType === 'rate' ? RATE_PROBE_SECONDS : null },
  }
  insertEntity(sql, 'probes', probe)
  audit(sql, actor, 'probes.create', 'probes', probe.id, undefined, probe, at)
  return probe
}

/**
 * Job op (daily cron), PRD 1B "Data needed" / principle 6. Fewer than 2 points
 * in 2 weeks: schedule a check (a probe for student mode). An attempt fails
 * when it brings no data within DATA_NEEDED_ATTEMPT_DAYS; while one is open no
 * other is scheduled. After 2 failed attempts a data_needed decision reaches
 * the case manager's digest.
 */
export const dataNeededScan = defineOp({
  name: 'dataNeeded.scan',
  room: 'student',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { scheduled: string[]; probes: string[]; alerted: string[] } {
    const at = nowIso(args.now)
    const scheduled: string[] = []
    const probes: string[] = []
    const alerted: string[] = []
    for (const objective of currentConfirmedObjectives(sql)) {
      const points = ev.toPoints(ev.headDataPoints(sql, { objectiveId: objective.id }))
      const lastAt = points.length > 0 ? points[points.length - 1].at : ''
      // Attempts since the last data point: none of them has brought data yet.
      const attempts = sql.all<{ at: string }>(
        'SELECT at FROM audit_log WHERE action = ? AND row_id = ? AND at > ? ORDER BY at',
        DATA_NEEDED_ACTION,
        objective.id,
        lastAt,
      )
      const failed = attempts.filter((a) => Date.parse(at) - Date.parse(a.at) >= daysToMs(DATA_NEEDED_ATTEMPT_DAYS)).length
      const open = attempts.length > failed
      const need = dataNeeded(points, at, failed)
      if (need === 'schedule_check' && !open) {
        const probe = scheduleProbe(sql, actor, objective, at)
        audit(sql, actor, DATA_NEEDED_ACTION, 'objectives', objective.id, undefined, { attempt: attempts.length + 1, probeId: probe?.id ?? null }, at)
        scheduled.push(objective.id)
        if (probe) probes.push(probe.id)
      } else if (need === 'alert') {
        const already = ev.decisions(sql, { objectiveIds: [objective.id], since: lastAt || undefined }).some((d) => d.rule === 'data_needed')
        if (!already) {
          insertDecision(sql, actor, objective, 'data_needed', at)
          alerted.push(objective.id)
        }
      }
    }
    return { scheduled, probes, alerted }
  },
})

// ---------- proficiency (PRD principle 7: the teacher sets it) ----------

function suggestionFor(sql: SqlExecutor, goalId: string): ProficiencySuggestion {
  const objective = confirmedObjectiveForGoal(sql, goalId)
  if (!objective) return suggestProficiency([], { baseline: null, target: 0, reviewDate: null })
  return suggestProficiency(ev.confirmedPoints(sql, objective.id), objective)
}

export const proficiencySuggest = defineOp({
  name: 'proficiency.suggest',
  room: 'student',
  capability: 'proficiency.set',
  args: StudentArgs.extend({ goalId: Id }),
  run(sql, args, actor): ProficiencySuggestion {
    authorize(actor, 'proficiency.set', args.studentId)
    return suggestionFor(sql, requireGoal(sql, args.goalId).id)
  },
})

export const proficiencySet = defineOp({
  name: 'proficiency.set',
  room: 'student',
  capability: 'proficiency.set',
  args: StudentArgs.extend({ goalId: Id, level: Proficiency, period: z.string().min(1), narrative: z.string().nullable().default(null) }).extend(Now.shape),
  run(sql, args, actor): { rating: ProficiencyRating } {
    authorize(actor, 'proficiency.set', args.studentId)
    const at = nowIso(args.now)
    const rating: ProficiencyRating = {
      id: newId(),
      goalId: requireGoal(sql, args.goalId).id,
      level: args.level,
      period: args.period,
      narrative: args.narrative,
      setBy: actor.userId,
      setAt: at,
    }
    insertEntity(sql, 'proficiency_ratings', rating)
    audit(sql, actor, 'proficiency_ratings.create', 'proficiency_ratings', rating.id, undefined, rating, at)
    return { rating }
  },
})

export const insightOpList = [aimlineGet, whatWorksGet, dataNeededScan, proficiencySuggest, proficiencySet]
