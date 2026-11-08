import { z } from 'zod'
import type { SessionNextResponse, SessionSupports } from '../contract/api'
import { Id } from '../contract/common'
import type { MetricType } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { ProbeForm, type AnswerKeyEntry, type CheckItem, type IepVersion, type Probe } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { audit, insertEntity, newId, nowIso } from '../repos/base'
import * as ev from '../repos/evidence'
import { currentConfirmedObjectives, currentIep, objectiveById } from '../repos/iep'
import { approvedChecks } from '../repos/lens'
import { probesForObjectives } from '../repos/records'
import { Now, StudentArgs, authorize, authorizeStaff, requireStudentSession } from './authz'
import { isObjectiveItem, scoreItem } from './scoring'
import { parseSourceRef, studentResponseRef } from './sources'
import { activeAdaptationIds, newDataPoint, requireConsent } from './student-common'
import { BREAK_TIMER_MINUTES } from './thresholds'

/**
 * Student mode (M3). Responses never carry IEP text, other students or adult
 * notes (PRD "Student mode never shows IEP text"); items come from approved
 * checks and scheduled probes, and are scored in code against the key.
 */

type SessionItem = {
  itemKey: string
  objectiveId: string
  item: CheckItem
  key: AnswerKeyEntry | undefined
  fromProbe: boolean
  /** Lesson of the approved adaptation that holds the check; null for probes. */
  lessonId: string | null
}

const lessonOfSuggestion = (sql: SqlExecutor, suggestionId: string): string | null =>
  sql.get<{ lesson_id: string }>('SELECT r.lesson_id FROM suggestions s JOIN lens_runs r ON r.id = s.lens_run_id WHERE s.id = ?', suggestionId)?.lesson_id ??
  null

/** Supports applied automatically from the IEP, as booleans only (PRD Student mode). */
export function supportsFrom(iep: IepVersion | undefined): SessionSupports {
  const text = iep ? [...iep.sections.supports, ...iep.sections.accommodations].join(' | ') : ''
  return {
    readAloud: /read[- ]?aloud/i.test(text),
    largerText: /larger text|large print|enlarged/i.test(text),
    fewerItems: /fewer items/i.test(text),
    visualSupports: /visual|pictogram/i.test(text),
    breakTimerMinutes: /break/i.test(text) ? BREAK_TIMER_MINUTES : null,
  }
}

/** Objective items with a key, from scheduled probes first, then approved checks. */
function sessionItems(sql: SqlExecutor): SessionItem[] {
  const objectives = currentConfirmedObjectives(sql).map((o) => o.id)
  const forms: { formId: string; objectiveId: string; items: CheckItem[]; key: AnswerKeyEntry[]; fromProbe: boolean; lessonId: string | null }[] = [
    ...probesForObjectives(sql, objectives).map((p: Probe) => ({
      formId: p.id,
      objectiveId: p.objectiveId,
      items: p.form.items,
      key: p.form.answerKey,
      fromProbe: true,
      lessonId: null,
    })),
    ...approvedChecks(sql)
      .filter((c) => c.answerKey && objectives.includes(c.objectiveId))
      .map((c) => ({
        formId: c.id,
        objectiveId: c.objectiveId,
        items: c.items,
        key: c.answerKey ?? [],
        fromProbe: false,
        lessonId: lessonOfSuggestion(sql, c.suggestionId),
      })),
  ]
  return forms.flatMap((f) =>
    f.items
      .filter((item) => isObjectiveItem(item) && f.key.some((k) => k.itemId === item.id))
      .map((item) => ({
        itemKey: `${f.formId}/${item.id}`,
        objectiveId: f.objectiveId,
        item,
        key: f.key.find((k) => k.itemId === item.id),
        fromProbe: f.fromProbe,
        lessonId: f.lessonId,
      })),
  )
}

/** Student-mode responses already stored, by item key and session. */
function responses(sql: SqlExecutor) {
  return ev.headDataPoints(sql, { sourceRefPrefix: 'student_response:' }).map((dp) => {
    const src = parseSourceRef(dp.sourceRef)
    return src.kind === 'student_response' ? { dp, sessionId: src.sessionId, itemKey: src.itemId } : null
  }).filter((r) => r !== null)
}

/**
 * Value of one scored item. Accuracy: 100 or 0 (percent correct). Rate:
 * correct items per minute from the item's time on task, so a timed probe's
 * points measure fluency (design doc M5 rate metric). Other metrics: 1 or 0.
 */
export function itemValue(metricType: MetricType, correct: boolean, durationMs: number | undefined): number {
  if (metricType === 'accuracy') return correct ? 100 : 0
  if (metricType === 'rate') {
    if (!durationMs) throw new AltamiraError('bad_request', 'a rate objective needs the time on task (durationMs)')
    return correct ? Math.round((60_000 / durationMs) * 100) / 100 : 0
  }
  return correct ? 1 : 0
}

export const sessionsStart = defineOp({
  name: 'sessions.start',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { consentId: string; supports: SessionSupports } {
    // PRD NFR Consent: sessions are started by a teacher or EA, and only with parental consent.
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const consent = requireConsent(sql, 'student_mode')
    audit(sql, actor, 'sessions.start', 'consents', consent.id, undefined, { consentId: consent.id }, nowIso(args.now))
    return { consentId: consent.id, supports: supportsFrom(currentIep(sql)) }
  },
})

export const sessionsNext = defineOp({
  name: 'sessions.next',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): SessionNextResponse {
    requireStudentSession(actor, args.studentId, nowIso(args.now))
    requireConsent(sql, 'student_mode')
    const done = new Set(responses(sql).map((r) => r.itemKey))
    const next = sessionItems(sql).find((i) => !done.has(i.itemKey))
    return {
      item: next ? { itemId: next.itemKey, prompt: next.item.prompt, format: next.item.format, options: next.item.options } : null,
      supports: supportsFrom(currentIep(sql)),
    }
  },
})

export const sessionsRespond = defineOp({
  name: 'sessions.respond',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend({
    itemId: z.string().min(1),
    response: z.string(),
    durationMs: z.number().int().min(0).optional(),
    readAloudUsed: z.boolean().default(false),
  }).extend(Now.shape),
  run(sql, args, actor): { correct: boolean } {
    const at = nowIso(args.now)
    const session = requireStudentSession(actor, args.studentId, at)
    requireConsent(sql, 'student_mode')
    const item = sessionItems(sql).find((i) => i.itemKey === args.itemId)
    if (!item) throw new AltamiraError('not_found', 'unknown item')
    if (responses(sql).some((r) => r.itemKey === item.itemKey)) throw new AltamiraError('bad_request', 'this item is already answered')
    // Deterministic scoring against the key, never by the model.
    const correct = scoreItem(item.item, item.key, args.response)
    if (correct === null) throw new AltamiraError('bad_request', 'this item cannot be scored automatically')
    const objective = objectiveById(sql, item.objectiveId)
    if (!objective) throw new AltamiraError('not_found', 'objective not found')
    const dataPoint = newDataPoint({
      id: newId(),
      objectiveId: objective.id,
      value: itemValue(objective.metricType, correct, args.durationMs),
      unit: objective.unit,
      source: item.fromProbe ? 'probe' : 'student',
      recorderId: session.startedBy ?? actor.userId,
      recordedAt: at,
      // PRD 1B "Timeline persistence": the lesson and the adaptations in force travel with the point.
      lessonId: item.lessonId,
      activeAdaptations: activeAdaptationIds(sql, item.lessonId),
      status: 'auto_confirmed',
      sourceRef: studentResponseRef(session.tokenId, item.itemKey),
      // PRD 1B "Capture sources": student mode records time on task and read-aloud use.
      sessionDetail: { timeOnTaskMs: args.durationMs ?? null, readAloud: args.readAloudUsed },
    })
    ev.insertDataPoint(sql, dataPoint)
    audit(sql, actor, 'data_points.create', 'data_points', dataPoint.id, undefined, dataPoint, at)
    return { correct }
  },
})

/** Strengths-based self view: what the student has completed and their current streak, no IEP wording. */
export const sessionsProgress = defineOp({
  name: 'sessions.progress',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend(Now.shape),
  run(sql, args, actor): { goals: { label: string; completed: number; streak: number }[] } {
    const allowed = authorize(actor, 'progress.view', args.studentId, { now: Date.parse(nowIso(args.now)) })
    if (allowed.filter !== 'self_simplified') throw new AltamiraError('forbidden', 'this view is for student mode')
    const all = responses(sql)
    return {
      goals: currentConfirmedObjectives(sql).map((o, i) => {
        const mine = all.filter((r) => r.dp.objectiveId === o.id).map((r) => r.dp.value > 0)
        let streak = 0
        for (let j = mine.length - 1; j >= 0 && mine[j]; j--) streak++
        return { label: `Practice ${i + 1}`, completed: mine.filter(Boolean).length, streak }
      }),
    }
  },
})

/** Places an equivalent probe form for an objective (PRD 1B "Scheduled probes"). */
export const probesSchedule = defineOp({
  name: 'probes.schedule',
  room: 'student',
  capability: 'lesson.augment',
  args: StudentArgs.extend({ objectiveId: Id, skill: z.string().min(1), level: z.string().min(1), form: ProbeForm }).extend(Now.shape),
  run(sql, args, actor): { probe: Probe } {
    authorize(actor, 'lesson.augment', args.studentId)
    if (!objectiveById(sql, args.objectiveId)) throw new AltamiraError('not_found', `objective ${args.objectiveId} not found`)
    const probe: Probe = { id: newId(), objectiveId: args.objectiveId, skill: args.skill, level: args.level, form: args.form }
    insertEntity(sql, 'probes', probe)
    audit(sql, actor, 'probes.create', 'probes', probe.id, undefined, probe, nowIso(args.now))
    return { probe }
  },
})

export const studentModeOpList = [sessionsStart, sessionsNext, sessionsRespond, sessionsProgress, probesSchedule]
