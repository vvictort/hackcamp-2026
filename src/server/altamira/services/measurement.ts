import { z } from 'zod'
import { CaptureEventBody, type GoalStatusResponse } from '../contract/api'
import { ProposeObjectivesOutput } from '../contract/ai'
import { ExpectedVersion, Id } from '../contract/common'
import { ReviewKind, promptLevelValue, type MetricType, type PromptLevel } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import type { Actor } from '../contract/permissions'
import {
  Goal,
  IepSections,
  Objective as ObjectiveSchema,
  type DataPoint,
  type Decision,
  type IepVersion,
  type Objective,
  type ReviewItem,
} from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { assertVersion, audit, insertEntity, json, newId, nowIso, parseRows, updateVersioned } from '../repos/base'
import * as ev from '../repos/evidence'
import * as iepRepo from '../repos/iep'
import { aimline, decisionRule, goalStatus } from './analytics'
import { Now, StudentArgs, authorize, authorizeStaff } from './authz'
import { eaEventRef, parseSourceRef } from './sources'
import { EVENT_SOURCE, activeAdaptationIds, newDataPoint, requireObjective } from './student-common'

/** Student-room ops for feature 1B (measurement core). */

type Row = Record<string, unknown>

// ---------- IEP import and confirmation (Student Profile) ----------

const subjectsOf = (sections: IepSections) => sections.modifications.map((m) => m.subject.trim().toLowerCase())

/** Imports a parsed CB-IEP as a pending version; nothing is in force until a case manager confirms it. */
export const iepImport = defineOp({
  name: 'iep.import',
  room: 'student',
  capability: 'iep.import',
  args: StudentArgs.extend({
    sections: IepSections,
    modificationSubjects: z.array(z.string()).optional(),
    sourceFileKey: z.string().nullable().default(null),
  }).extend(Now.shape),
  run(sql, args, actor): { iep: IepVersion; goals: Goal[] } {
    // PRD: only case managers create or change the IEP.
    authorize(actor, 'iep.import', args.studentId)
    const at = nowIso(args.now)
    const version = (iepRepo.latestIep(sql)?.version ?? 0) + 1
    const iep: IepVersion = {
      id: newId(),
      version,
      sections: args.sections,
      modificationSubjects: args.modificationSubjects ?? subjectsOf(args.sections),
      sourceFileKey: args.sourceFileKey,
      importedBy: actor.userId,
      importedAt: at,
      confirmedBy: null,
      confirmedAt: null,
      rowVersion: 1,
    }
    insertEntity(sql, 'iep_versions', iep)
    audit(sql, actor, 'iep_versions.import', 'iep_versions', iep.id, undefined, { version, sourceFileKey: iep.sourceFileKey }, at)
    const goals = args.sections.goals.map((g) => insertGoal(sql, actor, version, g.area, g.text, at))
    return { iep, goals }
  },
})

function insertGoal(sql: SqlExecutor, actor: Actor, iepVersion: number, area: string, text: string, at: string): Goal {
  const goal: Goal = { id: newId(), iepVersion, area, text, status: 'active', version: 1 }
  insertEntity(sql, 'goals', goal)
  audit(sql, actor, 'goals.create', 'goals', goal.id, undefined, goal, at)
  return goal
}

function closeGoal(sql: SqlExecutor, actor: Actor, goal: Goal, at: string): void {
  updateVersioned(sql, 'goals', goal.id, goal.version, { status: 'closed' })
  audit(sql, actor, 'goals.close', 'goals', goal.id, { status: goal.status }, { status: 'closed' }, at)
}

/** Side-by-side corrections to a pending import: goals follow the corrected sections, by position. */
function syncGoals(sql: SqlExecutor, actor: Actor, version: number, sections: IepSections, at: string): void {
  const existing = iepRepo.goalsForVersion(sql, version)
  sections.goals.forEach((g, i) => {
    const old = existing[i]
    if (!old) insertGoal(sql, actor, version, g.area, g.text, at)
    else if (old.area !== g.area || old.text !== g.text || old.status !== 'active') {
      updateVersioned(sql, 'goals', old.id, old.version, { area: g.area, text: g.text, status: 'active' })
      audit(sql, actor, 'goals.edit', 'goals', old.id, old, { ...old, area: g.area, text: g.text, status: 'active' }, at)
    }
  })
  existing.slice(sections.goals.length).filter((g) => g.status === 'active').forEach((g) => closeGoal(sql, actor, g, at))
}

export const iepConfirm = defineOp({
  name: 'iep.confirm',
  room: 'student',
  capability: 'iep.import',
  args: StudentArgs.extend({
    version: z.number().int().min(1),
    sections: IepSections.optional(),
    modificationSubjects: z.array(z.string()).optional(),
  })
    .extend(ExpectedVersion.shape)
    .extend(Now.shape),
  run(sql, args, actor): { iep: IepVersion; goals: Goal[]; objectives: Objective[] } {
    authorize(actor, 'iep.import', args.studentId)
    const iep = iepRepo.iepByVersion(sql, args.version)
    if (!iep) throw new AltamiraError('not_found', `IEP version ${args.version} not found`)
    assertVersion(iep.rowVersion, args.expectedVersion, `IEP version ${iep.version}`)
    // A confirmed IEP is never edited; a change is a new imported version.
    if (iep.confirmedAt) throw new AltamiraError('bad_request', 'this IEP version is already confirmed')
    const current = iepRepo.currentIep(sql)
    if (current && current.version > iep.version) throw new AltamiraError('bad_request', 'a newer IEP version is already confirmed')

    const at = nowIso(args.now)
    const sections = args.sections ?? iep.sections
    const modificationSubjects = args.modificationSubjects ?? (args.sections ? subjectsOf(sections) : iep.modificationSubjects)
    updateVersioned(
      sql,
      'iep_versions',
      iep.id,
      iep.rowVersion,
      { sections_json: json(sections), modification_subjects_json: json(modificationSubjects), confirmed_by: actor.userId, confirmed_at: at },
      'row_version',
    )
    const confirmed: IepVersion = { ...iep, sections, modificationSubjects, confirmedBy: actor.userId, confirmedAt: at, rowVersion: iep.rowVersion + 1 }
    audit(sql, actor, 'iep_versions.confirm', 'iep_versions', iep.id, iep, confirmed, at)
    if (args.sections) syncGoals(sql, actor, iep.version, sections, at)

    // Goals of older versions close; their evidence stays on the timeline.
    const older = parseRows(
      Goal,
      sql.all<Row>("SELECT * FROM goals WHERE iep_version < ? AND status = 'active'", iep.version),
    )
    older.forEach((g) => closeGoal(sql, actor, g, at))

    const goals = iepRepo.goalsForVersion(sql, iep.version)
    return { iep: confirmed, goals, objectives: iepRepo.objectivesForGoals(sql, goals.map((g) => g.id)) }
  },
})

// ---------- objectives ----------

export const objectivesList = defineOp({
  name: 'objectives.list',
  room: 'student',
  capability: 'iep.view',
  args: StudentArgs,
  run(sql, args, actor): { objectives: Objective[] } {
    authorize(actor, 'iep.view', args.studentId)
    const rows = sql.all<Row>(
      "SELECT o.* FROM objectives o JOIN goals g ON g.id = o.goal_id WHERE g.status = 'active' ORDER BY o.rowid",
    )
    return { objectives: parseRows(ObjectiveSchema, rows) }
  },
})

/**
 * What a voice-note parser needs to file events (EA capture): confirmed
 * objectives' ids, metric types and units only, no IEP text.
 */
export const objectivesForCapture = defineOp({
  name: 'objectives.forCapture',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs,
  run(sql, args, actor): { objectives: { objectiveId: string; metricType: MetricType; unit: string }[] } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    return { objectives: iepRepo.currentConfirmedObjectives(sql).map((o) => ({ objectiveId: o.id, metricType: o.metricType, unit: o.unit })) }
  },
})

/** Stores AI-proposed objectives for case-manager confirmation (one per goal). */
export const objectivesPropose = defineOp({
  name: 'objectives.propose',
  room: 'student',
  capability: 'iep.import',
  args: StudentArgs.extend({ proposals: z.array(ProposeObjectivesOutput) }).extend(Now.shape),
  run(sql, args, actor): { objectives: Objective[]; unmeasurable: { goalId: string; reason: string }[] } {
    authorize(actor, 'iep.import', args.studentId)
    const at = nowIso(args.now)
    const objectives: Objective[] = []
    const unmeasurable: { goalId: string; reason: string }[] = []
    for (const p of args.proposals) {
      const goal = iepRepo.goalById(sql, p.goalId)
      if (!goal) throw new AltamiraError('not_found', `goal ${p.goalId} not found`)
      const existing = iepRepo.objectivesForGoals(sql, [goal.id])[0]
      if (!p.measurable) {
        unmeasurable.push({ goalId: p.goalId, reason: p.reason })
        // PRD 1B: goals that can't be measured are flagged for the IEP team, as a stored objective row.
        if (!existing) objectives.push(insertFlagged(sql, actor, goal, p.reason, at))
        continue
      }
      if (existing) {
        objectives.push(existing)
        continue
      }
      const objective: Objective = {
        id: newId(),
        goalId: goal.id,
        metricType: p.metricType,
        unit: p.unit,
        baseline: null,
        baselineMethod: p.baselineMethod,
        target: p.target,
        masteryRule: p.masteryRule,
        reviewDate: iepRepo.iepByVersion(sql, goal.iepVersion)?.sections.reviewDate ?? null,
        captureMethod: p.captureMethod,
        status: 'proposed',
        flagReason: null,
        confirmedBy: null,
        confirmedAt: null,
        version: 1,
      }
      insertEntity(sql, 'objectives', objective)
      audit(sql, actor, 'objectives.propose', 'objectives', objective.id, undefined, objective, at)
      objectives.push(objective)
    }
    return { objectives, unmeasurable }
  },
})

/**
 * A goal the AI judged unmeasurable. The measure fields hold placeholders
 * (empty unit and mastery rule) until the case manager sets them when confirming.
 */
function insertFlagged(sql: SqlExecutor, actor: Actor, goal: Goal, reason: string, at: string): Objective {
  const objective: Objective = {
    id: newId(),
    goalId: goal.id,
    metricType: 'accuracy',
    unit: '',
    baseline: null,
    baselineMethod: null,
    target: 0,
    masteryRule: '',
    reviewDate: iepRepo.iepByVersion(sql, goal.iepVersion)?.sections.reviewDate ?? null,
    captureMethod: 'teacher',
    status: 'flagged_unmeasurable',
    flagReason: reason,
    confirmedBy: null,
    confirmedAt: null,
    version: 1,
  }
  insertEntity(sql, 'objectives', objective)
  audit(sql, actor, 'objectives.flag', 'objectives', objective.id, undefined, { status: objective.status, flagReason: reason }, at)
  return objective
}

const ObjectiveEdits = ObjectiveSchema.pick({
  metricType: true,
  unit: true,
  baseline: true,
  target: true,
  masteryRule: true,
  reviewDate: true,
  captureMethod: true,
}).partial()

export const objectivesConfirm = defineOp({
  name: 'objectives.confirm',
  room: 'student',
  capability: 'objective.confirm',
  args: StudentArgs.extend({ objectiveId: Id, edits: ObjectiveEdits.optional() }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { objective: Objective } {
    // PRD matrix: only the case manager confirms objectives; teachers propose.
    authorize(actor, 'objective.confirm', args.studentId)
    const o = requireObjective(sql, args.objectiveId)
    assertVersion(o.version, args.expectedVersion, `objective ${o.id}`)
    if (o.status === 'confirmed') throw new AltamiraError('bad_request', 'objective is already confirmed')
    const at = nowIso(args.now)
    const next: Objective = { ...o, ...args.edits, status: 'confirmed', flagReason: null, confirmedBy: actor.userId, confirmedAt: at, version: o.version + 1 }
    if (!next.unit.trim() || !next.masteryRule.trim()) {
      throw new AltamiraError('bad_request', 'set the unit and mastery rule before confirming this objective')
    }
    updateVersioned(sql, 'objectives', o.id, o.version, {
      metric_type: next.metricType,
      unit: next.unit,
      baseline: next.baseline,
      target: next.target,
      mastery_rule: next.masteryRule,
      review_date: next.reviewDate,
      capture_method: next.captureMethod,
      status: 'confirmed',
      flag_reason: null,
      confirmed_by: actor.userId,
      confirmed_at: at,
    })
    audit(sql, actor, 'objectives.confirm', 'objectives', o.id, o, next, at)
    return { objective: next }
  },
})

export const objectivesFlagUnmeasurable = defineOp({
  name: 'objectives.flagUnmeasurable',
  room: 'student',
  capability: 'objective.confirm',
  args: StudentArgs.extend({ objectiveId: Id, reason: z.string().min(1) }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { objective: Objective } {
    authorize(actor, 'objective.confirm', args.studentId)
    const o = requireObjective(sql, args.objectiveId)
    updateVersioned(sql, 'objectives', o.id, args.expectedVersion, { status: 'flagged_unmeasurable', flag_reason: args.reason })
    const next: Objective = { ...o, status: 'flagged_unmeasurable', flagReason: args.reason, version: o.version + 1 }
    audit(sql, actor, 'objectives.flag', 'objectives', o.id, { status: o.status }, { status: next.status, flagReason: args.reason }, nowIso(args.now))
    return { objective: next }
  },
})

// ---------- evidence capture ----------

/** Confidence routing decided by the caller (threshold + random sample); the op enforces its shape. */
export const Routing = z.discriminatedUnion('status', [
  z.object({ status: z.literal('auto_confirmed'), reviewKind: z.null().default(null) }),
  z.object({ status: z.literal('pending_review'), reviewKind: ReviewKind }),
])
export type Routing = z.infer<typeof Routing>

function openReview(sql: SqlExecutor, actor: Actor, dataPointId: string, kind: ReviewItem['kind'], at: string): ReviewItem {
  const item: ReviewItem = { id: newId(), dataPointId, kind, status: 'open', createdAt: at, resolvedBy: null, resolvedAt: null, version: 1 }
  insertEntity(sql, 'review_queue', item)
  audit(sql, actor, 'review_queue.create', 'review_queue', item.id, undefined, item, at)
  return item
}

/**
 * Stores one AI-scored data point with its routing. Rubric scores always go
 * to review (PRD 1B metric rollout: never auto-confirmed until agreement is
 * proven, which this build does not track).
 */
export function storeScoredPoint(
  sql: SqlExecutor,
  actor: Actor,
  p: { objective: Objective; value: number; aiConfidence: number; routing: Routing; sourceRef: string; source: DataPoint['source']; classId: string | null; lessonId: string | null; recordedAt: string },
  at: string,
): { dataPoint: DataPoint; reviewItem: ReviewItem | null } {
  const routing: Routing = p.objective.metricType === 'rubric' && p.routing.status !== 'pending_review'
    ? { status: 'pending_review', reviewKind: 'sampled' }
    : p.routing
  const dataPoint = newDataPoint({
    id: newId(),
    objectiveId: p.objective.id,
    value: p.value,
    unit: p.objective.unit,
    source: p.source,
    recorderId: actor.userId,
    recordedAt: p.recordedAt,
    classId: p.classId,
    lessonId: p.lessonId,
    activeAdaptations: activeAdaptationIds(sql, p.lessonId),
    aiConfidence: p.aiConfidence,
    status: routing.status,
    sourceRef: p.sourceRef,
  })
  ev.insertDataPoint(sql, dataPoint)
  audit(sql, actor, 'data_points.create', 'data_points', dataPoint.id, undefined, dataPoint, at)
  const reviewItem = routing.status === 'pending_review' ? openReview(sql, actor, dataPoint.id, routing.reviewKind, at) : null
  return { dataPoint, reviewItem }
}

export const dataPointsAddPending = defineOp({
  name: 'dataPoints.addPending',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend({
    objectiveId: Id,
    value: z.number(),
    aiConfidence: z.number().min(0).max(1),
    routing: Routing,
    /** photo:<fileKey>#<itemId>; required (PRD principle 9). */
    sourceRef: z.string().min(1),
    classId: Id.nullable().default(null),
    lessonId: Id.nullable().default(null),
    recordedAt: z.string().optional(),
  }).extend(Now.shape),
  run(sql, args, actor) {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const at = nowIso(args.now)
    return storeScoredPoint(
      sql,
      actor,
      {
        objective: requireObjective(sql, args.objectiveId),
        value: args.value,
        aiConfidence: args.aiConfidence,
        routing: args.routing,
        sourceRef: args.sourceRef,
        source: 'photo',
        classId: args.classId,
        lessonId: args.lessonId,
        recordedAt: args.recordedAt ?? at,
      },
      at,
    )
  },
})

/** Which metric types an EA event can feed. */
const EVENT_METRICS: Record<CaptureEventBody['kind'], readonly MetricType[]> = {
  prompt_level: ['prompt_level'],
  // A teacher's one-tap rating records a whole-number score (accuracy %, rubric level, rate) as a counter.
  counter: ['frequency', 'accuracy', 'rate', 'rubric'],
  timer: ['duration', 'latency'],
}

export type EventInput =
  | { kind: 'prompt_level'; promptLevel: PromptLevel }
  | { kind: 'counter'; count: number }
  | { kind: 'timer'; durationSeconds: number }

/** Value stored for an event; the event kind must match the objective's metric type. */
export function eventValue(event: EventInput, objective: Objective): number {
  if (!EVENT_METRICS[event.kind].includes(objective.metricType)) {
    throw new AltamiraError('bad_request', `a ${event.kind} event cannot feed a ${objective.metricType} objective`)
  }
  if (event.kind === 'prompt_level') return promptLevelValue(event.promptLevel)
  if (event.kind === 'counter') return event.count
  return event.durationSeconds
}

/** EA-assisted capture: prompt level, counter or timer. Each entry records who captured it (PRD 1B). */
export const eventsRecord = defineOp({
  name: 'events.record',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend({ event: CaptureEventBody }).extend(Now.shape),
  run(sql, args, actor): { dataPoint: DataPoint } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const at = nowIso(args.now)
    const objective = requireObjective(sql, args.event.objectiveId)
    const id = newId()
    const dataPoint = newDataPoint({
      id,
      objectiveId: objective.id,
      value: eventValue(args.event, objective),
      unit: objective.unit,
      source: EVENT_SOURCE,
      recorderId: actor.userId,
      recordedAt: args.event.recordedAt ?? at,
      classId: args.event.classId,
      lessonId: args.event.lessonId,
      activeAdaptations: activeAdaptationIds(sql, args.event.lessonId),
      status: 'confirmed',
      sourceRef: eaEventRef(args.event.kind, id),
    })
    ev.insertDataPoint(sql, dataPoint)
    audit(sql, actor, 'data_points.create', 'data_points', id, undefined, dataPoint, at)
    return { dataPoint }
  },
})

// ---------- corrections and review (PRD: "Corrections never overwrite") ----------

function requireHeadPoint(sql: SqlExecutor, id: string): DataPoint {
  const dp = ev.dataPointById(sql, id)
  if (!dp) throw new AltamiraError('not_found', `data point ${id} not found`)
  if (!ev.isHead(sql, id)) throw new AltamiraError('version_conflict', `data point ${id} has already been corrected`)
  return dp
}

function resolveReviews(sql: SqlExecutor, actor: Actor, dataPointId: string, at: string): void {
  for (const r of ev.openReviewForDataPoint(sql, dataPointId)) {
    updateVersioned(sql, 'review_queue', r.id, r.version, { status: 'resolved', resolved_by: actor.userId, resolved_at: at })
    audit(sql, actor, 'review_queue.resolve', 'review_queue', r.id, { status: 'open' }, { status: 'resolved' }, at)
  }
}

/** A correction is a new row (supersedes_id + reason) carrying who changed it; the old row is never edited. */
function writeCorrection(sql: SqlExecutor, actor: Actor, old: DataPoint, value: number, reason: string, at: string): DataPoint {
  const corrected: DataPoint = { ...old, id: newId(), value, status: 'confirmed', recorderId: actor.userId, version: old.version + 1, supersedesId: old.id, reason }
  ev.insertDataPoint(sql, corrected)
  audit(sql, actor, 'data_points.correct', 'data_points', corrected.id, old, corrected, at)
  resolveReviews(sql, actor, old.id, at)
  return corrected
}

export const dataPointsCorrect = defineOp({
  name: 'dataPoints.correct',
  room: 'student',
  capability: 'review.confirm',
  args: StudentArgs.extend({ dataPointId: Id, value: z.number(), reason: z.string().min(1) }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { dataPoint: DataPoint } {
    const old = requireHeadPoint(sql, args.dataPointId)
    // PRD matrix: EAs correct only their own entries.
    authorize(actor, 'review.confirm', args.studentId, { recordedBy: old.recorderId })
    assertVersion(old.version, args.expectedVersion, `data point ${old.id}`)
    return { dataPoint: writeCorrection(sql, actor, old, args.value, args.reason, nowIso(args.now)) }
  },
})

export const reviewList = defineOp({
  name: 'review.list',
  room: 'student',
  capability: 'review.confirm',
  args: StudentArgs,
  run(sql, args, actor): { items: { studentId: string; item: ReviewItem; dataPoint: DataPoint }[] } {
    authorize(actor, 'review.confirm', args.studentId, { recordedBy: actor.userId })
    const items: { studentId: string; item: ReviewItem; dataPoint: DataPoint }[] = []
    for (const item of ev.openReviewItems(sql)) {
      const dataPoint = ev.dataPointById(sql, item.dataPointId)
      if (!dataPoint) continue
      // The EA and the teacher see only their own captures.
      if (dataPoint.recorderId !== actor.userId) continue
      items.push({ studentId: args.studentId, item, dataPoint })
    }
    return { items }
  },
})

export const reviewConfirm = defineOp({
  name: 'review.confirm',
  room: 'student',
  capability: 'review.confirm',
  args: StudentArgs.extend({ reviewId: Id, value: z.number().optional() }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { dataPoint: DataPoint } {
    const item = ev.reviewById(sql, args.reviewId)
    if (!item) throw new AltamiraError('not_found', `review item ${args.reviewId} not found`)
    assertVersion(item.version, args.expectedVersion, `review item ${item.id}`)
    if (item.status !== 'open') throw new AltamiraError('bad_request', 'review item is already resolved')
    const dp = requireHeadPoint(sql, item.dataPointId)
    authorize(actor, 'review.confirm', args.studentId, { recordedBy: dp.recorderId })
    const at = nowIso(args.now)
    if (args.value !== undefined && args.value !== dp.value) {
      return { dataPoint: writeCorrection(sql, actor, dp, args.value, 'corrected in review', at) }
    }
    updateVersioned(sql, 'data_points', dp.id, dp.version, { status: 'confirmed' })
    const confirmed: DataPoint = { ...dp, status: 'confirmed', version: dp.version + 1 }
    audit(sql, actor, 'data_points.confirm', 'data_points', dp.id, { status: dp.status }, { status: 'confirmed' }, at)
    resolveReviews(sql, actor, dp.id, at)
    return { dataPoint: confirmed }
  },
})

// ---------- timeline, goal status, source ----------

export const timelineGet = defineOp({
  name: 'timeline.get',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ from: z.string().optional(), to: z.string().optional(), objectiveId: Id.optional() }).extend(Now.shape),
  run(sql, args, actor): { dataPoints: DataPoint[]; decisions: Decision[] } {
    authorize(actor, 'progress.view', args.studentId)
    const dataPoints = ev.headDataPoints(sql, { objectiveId: args.objectiveId, from: args.from, to: args.to })
    const decisions = ev.decisions(sql, { objectiveIds: args.objectiveId ? [args.objectiveId] : undefined })
    return { dataPoints, decisions }
  },
})

export const goalStatusGet = defineOp({
  name: 'goal.status',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ goalId: Id }).extend(Now.shape),
  run(sql, args, actor): GoalStatusResponse {
    authorize(actor, 'progress.view', args.studentId)
    const goal = iepRepo.goalById(sql, args.goalId)
    if (!goal) throw new AltamiraError('not_found', `goal ${args.goalId} not found`)
    const objective = iepRepo.confirmedObjectiveForGoal(sql, goal.id)
    if (!objective) {
      return { goalId: goal.id, objectiveId: null, metricType: null, baseline: null, current: null, target: null, trend: null, projectedDate: null, recentCount: 0, canShowTrend: false, latestDecision: null }
    }
    const at = nowIso(args.now)
    const status = goalStatus(ev.confirmedPoints(sql, objective.id), objective, at)
    const latest = ev.latestDecision(sql, objective.id)?.rule ?? null
    return { goalId: goal.id, objectiveId: objective.id, metricType: objective.metricType, ...status, latestDecision: latest }
  },
})

export const dataPointSource = defineOp({
  name: 'dataPoint.source',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ dataPointId: Id }).extend(Now.shape),
  run(sql, args, actor) {
    authorize(actor, 'progress.view', args.studentId)
    const dataPoint = ev.dataPointById(sql, args.dataPointId)
    if (!dataPoint) throw new AltamiraError('not_found', `data point ${args.dataPointId} not found`)
    return { dataPoint, source: parseSourceRef(dataPoint.sourceRef) }
  },
})

/** Decision-rule evaluation for one objective; feeds the district insights goal-progress counter. */
export function evaluateObjective(sql: SqlExecutor, objective: Objective) {
  const points = ev.confirmedPoints(sql, objective.id)
  const line = aimline(points, objective, objective.confirmedAt ?? undefined)
  return { points, line, outcome: decisionRule(points, line) }
}

export const measurementOpList = [
  iepImport,
  iepConfirm,
  objectivesList,
  objectivesForCapture,
  objectivesPropose,
  objectivesConfirm,
  objectivesFlagUnmeasurable,
  dataPointsAddPending,
  eventsRecord,
  dataPointsCorrect,
  reviewList,
  reviewConfirm,
  timelineGet,
  goalStatusGet,
  dataPointSource,
]
