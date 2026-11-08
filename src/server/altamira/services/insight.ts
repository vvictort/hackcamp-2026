import { z } from 'zod'
import type { DraftProgressInput } from '../contract/ai'
import { DateString, ExpectedVersion, Id } from '../contract/common'
import { Proficiency } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import { DraftSentence, type Decision, type DraftCitation, type Objective, type ProficiencyRating, type ProgressDraft } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { assertVersion, audit, insertEntity, json, newId, nowIso, updateVersioned } from '../repos/base'
import * as ev from '../repos/evidence'
import { confirmedObjectiveForGoal, currentConfirmedObjectives, goalById } from '../repos/iep'
import { draftById } from '../repos/records'
import { FAMILY_VISIBLE_STATUSES } from '../contract/enums'
import { aimline, dataNeeded, suggestProficiency, type DecisionOutcome, type ProficiencySuggestion, type WhatWorksRow } from './analytics'
import { Now, StudentArgs, authorize } from './authz'
import { evaluateObjective } from './measurement'
import { whatWorksFor } from './student-common'
import { DIGEST_WINDOW_DAYS, daysToMs } from './thresholds'

/** M3 insight ops: aimline, what works, decision rules and digest, data needed, proficiency, Progress Drafts. */

const RULE_FOR: Partial<Record<DecisionOutcome, Decision['rule']>> = {
  change_approach: 'below_aimline',
  raise_goal: 'above_aimline',
}

const minusDays = (iso: string, days: number) => new Date(Date.parse(iso) - daysToMs(days)).toISOString()

function requireGoal(sql: SqlExecutor, goalId: string) {
  const goal = goalById(sql, goalId)
  if (!goal) throw new AltamiraError('not_found', `goal ${goalId} not found`)
  return goal
}

function forbidSelfView(filter: string) {
  if (filter === 'self_simplified') throw new AltamiraError('forbidden', 'student mode shows progress through sessions')
}

// ---------- aimline and what works ----------

export const aimlineGet = defineOp({
  name: 'aimline.get',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ goalId: Id }),
  run(sql, args, actor) {
    forbidSelfView(authorize(actor, 'progress.view', args.studentId).filter)
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
    forbidSelfView(authorize(actor, 'progress.view', args.studentId).filter)
    return { rows: whatWorksFor(sql) }
  },
})

// ---------- decision rules and weekly digest ----------

/** Fires decision rules for confirmed objectives; one row per rule per objective per digest window. */
function evaluateDecisions(sql: SqlExecutor, actor: Actor, at: string): Decision[] {
  const fired: Decision[] = []
  const since = minusDays(at, DIGEST_WINDOW_DAYS)
  for (const objective of currentConfirmedObjectives(sql)) {
    const rule = RULE_FOR[evaluateObjective(sql, objective).outcome]
    if (!rule) continue
    if (ev.decisions(sql, { objectiveIds: [objective.id], since }).some((d) => d.rule === rule)) continue
    fired.push(insertDecision(sql, actor, objective, rule, at))
  }
  return fired
}

function insertDecision(sql: SqlExecutor, actor: Actor, objective: Objective, rule: Decision['rule'], at: string): Decision {
  const decision: Decision = { id: newId(), objectiveId: objective.id, rule, firedAt: at, response: null, respondedBy: null, version: 1 }
  insertEntity(sql, 'decisions', decision)
  audit(sql, actor, 'decisions.fire', 'decisions', decision.id, undefined, decision, at)
  return decision
}

/** Job op (weekly cron): evaluates decision rules. Not exposed to users. */
export const decisionsEvaluate = defineOp({
  name: 'decisions.evaluate',
  room: 'student',
  args: StudentArgs.extend(Now.shape),
  run: (sql, args, actor) => ({ fired: evaluateDecisions(sql, actor, nowIso(args.now)) }),
})

/** GET /me/digest, per student. PRD 1B: alerts go to the case manager only; teachers see status. */
export const digestWeekly = defineOp({
  name: 'digest.weekly',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { items: { studentId: string; decision: Decision }[] } {
    const allowed = authorize(actor, 'progress.view', args.studentId)
    if (allowed.role !== 'case_manager') throw new AltamiraError('forbidden', 'the digest is for case managers')
    const at = nowIso(args.now)
    evaluateDecisions(sql, actor, at)
    const objectiveIds = currentConfirmedObjectives(sql).map((o) => o.id)
    const recent = ev.decisions(sql, { objectiveIds, since: minusDays(at, DIGEST_WINDOW_DAYS) })
    return { items: recent.map((decision) => ({ studentId: args.studentId, decision })) }
  },
})

// ---------- data needed (PRD 1B, principle 6) ----------

const DATA_NEEDED_ACTION = 'dataNeeded.schedule'

/**
 * Job op (daily cron). Fewer than 2 points in 2 weeks: record a scheduling
 * attempt and return the objective so the next lesson gets a check or probe.
 * After 2 failed attempts a data_needed decision reaches the case manager's digest.
 */
export const dataNeededScan = defineOp({
  name: 'dataNeeded.scan',
  room: 'student',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { scheduled: string[]; alerted: string[] } {
    const at = nowIso(args.now)
    const scheduled: string[] = []
    const alerted: string[] = []
    for (const objective of currentConfirmedObjectives(sql)) {
      const points = ev.toPoints(ev.headDataPoints(sql, { objectiveId: objective.id }))
      const lastAt = points.length > 0 ? points[points.length - 1].at : ''
      const attempts = sql.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND row_id = ? AND at > ?',
        DATA_NEEDED_ACTION,
        objective.id,
        lastAt,
      )?.n ?? 0
      const need = dataNeeded(points, at, attempts)
      if (need === 'schedule_check') {
        audit(sql, actor, DATA_NEEDED_ACTION, 'objectives', objective.id, undefined, { attempt: attempts + 1 }, at)
        scheduled.push(objective.id)
      } else if (need === 'alert') {
        const already = ev.decisions(sql, { objectiveIds: [objective.id], since: lastAt || undefined }).some((d) => d.rule === 'data_needed')
        if (!already) {
          insertDecision(sql, actor, objective, 'data_needed', at)
          alerted.push(objective.id)
        }
      }
    }
    return { scheduled, alerted }
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

// ---------- Progress Drafts ----------

/** Input for draftProgress: confirmed points only. The route adds studentToken; the AI module de-identifies. */
export const draftsContext = defineOp({
  name: 'drafts.context',
  room: 'student',
  capability: 'draft.edit',
  args: StudentArgs.extend({ goalId: Id, period: z.string().min(1) }),
  run(sql, args, actor): Omit<DraftProgressInput, 'studentToken'> {
    authorize(actor, 'draft.edit', args.studentId)
    const goal = requireGoal(sql, args.goalId)
    const objective = confirmedObjectiveForGoal(sql, goal.id)
    const points = objective ? ev.headDataPoints(sql, { objectiveId: objective.id, confirmedOnly: true }) : []
    return {
      period: args.period,
      goal: { goalId: goal.id, area: goal.area, text: goal.text },
      objective: objective ? { metricType: objective.metricType, unit: objective.unit, target: objective.target } : null,
      dataPoints: points.map((p) => ({ id: p.id, value: p.value, unit: p.unit, recordedAt: p.recordedAt, source: p.source })),
      proficiencySuggestion: suggestionFor(sql, goal.id).level,
    }
  },
})

/**
 * Citation check in the room: every cited id must exist in this student's
 * room, be current and be confirmed (PRD Progress Drafts: "citations checked in code").
 */
export function citationErrors(sql: SqlExecutor, sentences: readonly DraftSentence[], requireEach: boolean): string[] {
  const errors: string[] = []
  sentences.forEach((s, i) => {
    if (requireEach && s.citations.length === 0) errors.push(`sentence ${i} cites no data point`)
    for (const id of s.citations) {
      const dp = ev.dataPointById(sql, id)
      if (!dp) errors.push(`sentence ${i} cites unknown or foreign data point ${id}`)
      else if (!(FAMILY_VISIBLE_STATUSES as readonly string[]).includes(dp.status)) errors.push(`sentence ${i} cites unconfirmed data point ${id}`)
      else if (!ev.isHead(sql, id)) errors.push(`sentence ${i} cites superseded data point ${id}`)
    }
  })
  return errors
}

function writeCitations(sql: SqlExecutor, actor: Actor, draftId: string, sentences: readonly DraftSentence[], at: string): void {
  sentences.forEach((s, sentenceIndex) => {
    for (const dataPointId of s.citations) {
      const citation: DraftCitation = { id: newId(), draftId, sentenceIndex, dataPointId }
      insertEntity(sql, 'draft_citations', citation)
    }
  })
  audit(sql, actor, 'draft_citations.write', 'draft_citations', draftId, undefined, sentences.map((s) => s.citations), at)
}

export const draftsSave = defineOp({
  name: 'drafts.save',
  room: 'student',
  capability: 'draft.edit',
  args: StudentArgs.extend({
    goalId: Id,
    period: z.string().min(1),
    dueDate: DateString.nullable().default(null),
    sentences: z.array(DraftSentence).min(1),
    /** Result of the AI module's citation checker; the room checks again. */
    citationCheck: z.object({ valid: z.boolean(), errors: z.array(z.string()).default([]) }),
  }).extend(Now.shape),
  run(sql, args, actor): { draft: ProgressDraft } {
    authorize(actor, 'draft.edit', args.studentId)
    const goal = requireGoal(sql, args.goalId)
    // PRD Progress Drafts: a draft with an invalid or foreign citation is rejected.
    const errors = [...(args.citationCheck.valid ? [] : args.citationCheck.errors.length ? args.citationCheck.errors : ['citation check failed']), ...citationErrors(sql, args.sentences, true)]
    if (errors.length > 0) throw new AltamiraError('bad_request', `draft rejected: ${errors.join('; ')}`)
    const at = nowIso(args.now)
    const draft: ProgressDraft = {
      id: newId(),
      goalId: goal.id,
      period: args.period,
      dueDate: args.dueDate,
      sentences: args.sentences,
      proficiencySuggestion: suggestionFor(sql, goal.id).level,
      status: 'draft',
      createdBy: actor.userId,
      createdAt: at,
      updatedBy: null,
      updatedAt: null,
      usedAt: null,
      version: 1,
    }
    insertEntity(sql, 'progress_drafts', draft)
    audit(sql, actor, 'progress_drafts.create', 'progress_drafts', draft.id, undefined, draft, at)
    writeCitations(sql, actor, draft.id, draft.sentences, at)
    return { draft }
  },
})

function requireDraft(sql: SqlExecutor, id: string): ProgressDraft {
  const draft = draftById(sql, id)
  if (!draft) throw new AltamiraError('not_found', `draft ${id} not found`)
  return draft
}

export const draftsGet = defineOp({
  name: 'drafts.get',
  room: 'student',
  capability: 'draft.edit',
  args: StudentArgs.extend({ draftId: Id }),
  run(sql, args, actor): { draft: ProgressDraft } {
    authorize(actor, 'draft.edit', args.studentId)
    return { draft: requireDraft(sql, args.draftId) }
  },
})

/** Teacher edits. Citations that remain must still be valid; a sentence the teacher writes may cite nothing. */
export const draftsUpdate = defineOp({
  name: 'drafts.update',
  room: 'student',
  capability: 'draft.edit',
  args: StudentArgs.extend({ draftId: Id, sentences: z.array(DraftSentence) }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { draft: ProgressDraft } {
    authorize(actor, 'draft.edit', args.studentId)
    const draft = requireDraft(sql, args.draftId)
    assertVersion(draft.version, args.expectedVersion, `draft ${draft.id}`)
    const errors = citationErrors(sql, args.sentences, false)
    if (errors.length > 0) throw new AltamiraError('bad_request', `draft rejected: ${errors.join('; ')}`)
    const at = nowIso(args.now)
    updateVersioned(sql, 'progress_drafts', draft.id, draft.version, {
      sentences_json: json(args.sentences),
      status: 'edited',
      updated_by: actor.userId,
      updated_at: at,
    })
    const next: ProgressDraft = { ...draft, sentences: args.sentences, status: 'edited', updatedBy: actor.userId, updatedAt: at, version: draft.version + 1 }
    audit(sql, actor, 'progress_drafts.edit', 'progress_drafts', draft.id, draft, next, at)
    sql.run('DELETE FROM draft_citations WHERE draft_id = ?', draft.id)
    writeCitations(sql, actor, draft.id, args.sentences, at)
    return { draft: next }
  },
})

export const draftsMarkUsed = defineOp({
  name: 'drafts.markUsed',
  room: 'student',
  capability: 'draft.edit',
  args: StudentArgs.extend({ draftId: Id }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { draft: ProgressDraft } {
    authorize(actor, 'draft.edit', args.studentId)
    const draft = requireDraft(sql, args.draftId)
    const at = nowIso(args.now)
    updateVersioned(sql, 'progress_drafts', draft.id, args.expectedVersion, { status: 'used', used_at: at })
    const next: ProgressDraft = { ...draft, status: 'used', usedAt: at, version: draft.version + 1 }
    audit(sql, actor, 'progress_drafts.markUsed', 'progress_drafts', draft.id, { status: draft.status }, { status: 'used', usedAt: at }, at)
    return { draft: next }
  },
})

export const insightOpList = [
  aimlineGet,
  whatWorksGet,
  decisionsEvaluate,
  digestWeekly,
  dataNeededScan,
  proficiencySuggest,
  proficiencySet,
  draftsContext,
  draftsSave,
  draftsGet,
  draftsUpdate,
  draftsMarkUsed,
]
