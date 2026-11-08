import { z } from 'zod'
import type { TodayViewResponse } from '../contract/api'
import { VoiceEvent } from '../contract/ai'
import { ExpectedVersion, Id, TimeOfDay } from '../contract/common'
import { ConsentKind } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor } from '../contract/permissions'
import type { Consent, DataPoint, FamilySummary, Handoff, HandoffPacket, ParentInput, ProgressDraft } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { assertVersion, audit, insertEntity, newId, nowIso, updateVersioned } from '../repos/base'
import * as ev from '../repos/evidence'
import { confirmedObjectiveForGoal, currentGoals, currentIep, objectivesForGoals } from '../repos/iep'
import { approvedAdaptations } from '../repos/lens'
import * as records from '../repos/records'
import { goalStatus } from './analytics'
import { Now, StudentArgs, authorize, authorizeStaff } from './authz'
import { citationErrors } from './insight'
import { Routing, eventValue, storeScoredPoint, type EventInput } from './measurement'
import { eaEventRef } from './sources'
import { EVENT_SOURCE, requireConsent, requireObjective, whatWorksFor } from './student-common'

/** M4 ops: consent, parent input, Family Bridge, Today View, Transition Handoff, voice notes. */

// ---------- consent (PRD NFR Consent) ----------

export const consentsSet = defineOp({
  name: 'consents.set',
  room: 'student',
  capability: 'consent.manage',
  args: StudentArgs.extend({
    kind: ConsentKind,
    granted: z.boolean(),
    /** Required when a case manager records consent on a parent's behalf. */
    grantedBy: Id.optional(),
  }).extend(Now.shape),
  run(sql, args, actor): { consents: Consent[] } {
    // PRD matrix: parents manage consent; the case manager records it.
    const asParent = can(actor, 'consent.manage', args.studentId).allowed
    if (!asParent) authorize(actor, 'consent.record', args.studentId)
    const grantedBy = asParent ? actor.userId : args.grantedBy
    const at = nowIso(args.now)
    if (args.granted) {
      if (!grantedBy) throw new AltamiraError('bad_request', 'grantedBy names the parent or guardian who consented')
      if (!records.activeConsent(sql, args.kind)) {
        const consent: Consent = { id: newId(), kind: args.kind, grantedBy, recordedBy: actor.userId, grantedAt: at, revokedAt: null, version: 1 }
        insertEntity(sql, 'consents', consent)
        audit(sql, actor, 'consents.grant', 'consents', consent.id, undefined, consent, at)
      }
    } else {
      for (const c of records.listConsents(sql).filter((c) => c.kind === args.kind && !c.revokedAt)) {
        updateVersioned(sql, 'consents', c.id, c.version, { revoked_at: at })
        audit(sql, actor, 'consents.revoke', 'consents', c.id, { revokedAt: null }, { revokedAt: at }, at)
      }
    }
    return { consents: records.listConsents(sql) }
  },
})

export const consentsList = defineOp({
  name: 'consents.list',
  room: 'student',
  capability: 'consent.manage',
  args: StudentArgs,
  run(sql, args, actor): { consents: Consent[] } {
    const ok = (['consent.manage', 'consent.record'] as const).some((c) => can(actor, c, args.studentId).allowed)
    if (!ok) {
      const allowed = authorize(actor, 'progress.view', args.studentId)
      if (allowed.filter !== 'all') throw new AltamiraError('forbidden', 'consent records are not shown in this mode')
    }
    return { consents: records.listConsents(sql) }
  },
})

// ---------- parent input (to the case manager) ----------

export const parentInputCreate = defineOp({
  name: 'parentInput.create',
  room: 'student',
  capability: 'parent_input.send',
  args: StudentArgs.extend({ text: z.string().min(1), language: z.string().min(2) }).extend(Now.shape),
  run(sql, args, actor): { input: ParentInput } {
    authorize(actor, 'parent_input.send', args.studentId)
    const at = nowIso(args.now)
    const input: ParentInput = { id: newId(), authorId: actor.userId, text: args.text, language: args.language, createdAt: at, version: 1 }
    insertEntity(sql, 'parent_inputs', input)
    audit(sql, actor, 'parent_inputs.create', 'parent_inputs', input.id, undefined, input, at)
    return { input }
  },
})

export const parentInputList = defineOp({
  name: 'parentInput.list',
  room: 'student',
  capability: 'iep.write',
  args: StudentArgs,
  run(sql, args, actor): { inputs: ParentInput[] } {
    authorize(actor, 'iep.write', args.studentId)
    return { inputs: records.listParentInputs(sql) }
  },
})

// ---------- Family Bridge ----------

/** GET /family/:id/progress. Confirmed and auto-confirmed data only, filtered in SQL (PRD "Parents see only confirmed data"). */
export const familyProgress = defineOp({
  name: 'family.progress',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ lessonTitles: z.record(z.string(), z.string()).default({}) }),
  run(sql, args, actor) {
    const allowed = authorize(actor, 'progress.view', args.studentId)
    if (allowed.filter !== 'confirmed_only' && allowed.filter !== 'all') throw new AltamiraError('forbidden', 'family view is for parents and staff')
    const goals = currentGoals(sql).map((g) => ({
      goal: { id: g.id, area: g.area, text: g.text },
      dataPoints: ev.familyDataPoints(sql, objectivesForGoals(sql, [g.id]).map((o) => o.id)),
    }))
    const byLesson = new Map<string, { title: string; text: string }[]>()
    for (const a of approvedAdaptations(sql)) {
      byLesson.set(a.lessonId, [...(byLesson.get(a.lessonId) ?? []), { title: a.content.title, text: a.content.text }])
    }
    return {
      goals,
      summaries: records.approvedSummaries(sql),
      lessons: [...byLesson.entries()].map(([lessonId, adaptations]) => ({ lessonId, title: args.lessonTitles[lessonId] ?? 'Lesson', adaptations })),
    }
  },
})

/** Family outputs may rest only on current, confirmed data (PRD Family Bridge). */
function requireFamilySafeDraft(sql: SqlExecutor, draftId: string): ProgressDraft {
  const draft = records.draftById(sql, draftId)
  if (!draft) throw new AltamiraError('not_found', `draft ${draftId} not found`)
  const errors = citationErrors(sql, draft.sentences, false)
  if (errors.length > 0) throw new AltamiraError('bad_request', `draft cites data that is not confirmed: ${errors.join('; ')}`)
  return draft
}

export const familySummariesSave = defineOp({
  name: 'familySummaries.save',
  room: 'student',
  capability: 'family_summary.approve',
  args: StudentArgs.extend({ draftId: Id, language: z.string().min(2), text: z.string().min(1) }).extend(Now.shape),
  run(sql, args, actor): { summary: FamilySummary } {
    authorize(actor, 'family_summary.approve', args.studentId)
    const draft = requireFamilySafeDraft(sql, args.draftId)
    const at = nowIso(args.now)
    const summary: FamilySummary = { id: newId(), draftId: draft.id, language: args.language, text: args.text, status: 'draft', createdAt: at, approvedBy: null, approvedAt: null, version: 1 }
    insertEntity(sql, 'family_summaries', summary)
    audit(sql, actor, 'family_summaries.create', 'family_summaries', summary.id, undefined, summary, at)
    return { summary }
  },
})

export const familySummariesApprove = defineOp({
  name: 'familySummaries.approve',
  room: 'student',
  capability: 'family_summary.approve',
  args: StudentArgs.extend({ summaryId: Id, text: z.string().min(1).optional() }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { summary: FamilySummary } {
    authorize(actor, 'family_summary.approve', args.studentId)
    const summary = records.summaryById(sql, args.summaryId)
    if (!summary) throw new AltamiraError('not_found', `family summary ${args.summaryId} not found`)
    assertVersion(summary.version, args.expectedVersion, `family summary ${summary.id}`)
    if (summary.status === 'approved') throw new AltamiraError('bad_request', 'family summary is already approved')
    requireFamilySafeDraft(sql, summary.draftId)
    const at = nowIso(args.now)
    const text = args.text ?? summary.text
    updateVersioned(sql, 'family_summaries', summary.id, summary.version, { text, status: 'approved', approved_by: actor.userId, approved_at: at })
    const next: FamilySummary = { ...summary, text, status: 'approved', approvedBy: actor.userId, approvedAt: at, version: summary.version + 1 }
    audit(sql, actor, 'family_summaries.approve', 'family_summaries', summary.id, summary, next, at)
    return { summary: next }
  },
})

// ---------- Today View ----------

/**
 * GET /today/:token. Supports, today's approved adaptations, what works and
 * the schedule; no IEP text beyond supports (PRD Today View). Lesson titles
 * and the schedule come from the school room through the route.
 */
export const todayViewGet = defineOp({
  name: 'todayView.get',
  room: 'student',
  capability: 'iep.view',
  args: StudentArgs.extend({
    lessons: z.array(z.object({ lessonId: Id, title: z.string() })).default([]),
    schedule: z.array(z.object({ className: z.string(), startsAt: TimeOfDay, endsAt: TimeOfDay })).default([]),
  }).extend(Now.shape),
  run(sql, args, actor): TodayViewResponse {
    const at = nowIso(args.now)
    const allowed = authorize(actor, 'iep.view', args.studentId, { now: Date.parse(at) })
    if (!['today_view', 'supports_only', 'all'].includes(allowed.filter)) throw new AltamiraError('forbidden', 'Today View is for staff and substitute links')
    const iep = currentIep(sql)
    const titles = new Map(args.lessons.map((l) => [l.lessonId, l.title]))
    return {
      firstName: iep ? (iep.sections.student.preferredName ?? iep.sections.student.firstName) : null,
      expiresAt: actor.session?.expiresAt ?? `${at.slice(0, 10)}T23:59:59.999Z`,
      supports: iep?.sections.supports ?? [],
      approvedAdaptations: approvedAdaptations(sql)
        .filter((a) => titles.has(a.lessonId))
        .map((a) => ({ title: a.content.title, text: a.content.text, lessonTitle: titles.get(a.lessonId) ?? null })),
      whatWorks: whatWorksFor(sql).filter((r) => !r.hidden).map(({ adaptationType, n }) => ({ adaptationType, n })),
      schedule: args.schedule,
    }
  },
})

// ---------- Transition Handoff ----------

function trendLabel(trend: number | null, direction: number, unit: string): string | null {
  if (trend === null) return null
  const word = trend * direction > 0 ? 'improving' : trend === 0 ? 'flat' : 'declining'
  return `${word} (${trend >= 0 ? '+' : ''}${trend.toFixed(2)} ${unit} per week)`
}

export const handoffsCreate = defineOp({
  name: 'handoffs.create',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ toSchool: z.string().nullable().default(null) }).extend(Now.shape),
  run(sql, args, actor): { handoff: Handoff } {
    const allowed = authorize(actor, 'progress.view', args.studentId)
    if (allowed.filter !== 'all') throw new AltamiraError('forbidden', 'handoffs are prepared by the case manager or a teacher')
    const at = nowIso(args.now)
    const packet: HandoffPacket = {
      goals: currentGoals(sql).map((g) => {
        const objective = confirmedObjectiveForGoal(sql, g.id)
        let trend: string | null = null
        if (objective) {
          const status = goalStatus(ev.confirmedPoints(sql, objective.id), objective, at)
          const direction = Math.sign(objective.target - (status.baseline ?? objective.target)) || 1
          trend = status.canShowTrend ? trendLabel(status.trend, direction, objective.unit) : null
        }
        return { goalId: g.id, area: g.area, text: g.text, trend, proficiency: records.latestProficiency(sql, g.id)?.level ?? null }
      }),
      whatWorks: whatWorksFor(sql).filter((r) => !r.hidden).map(({ adaptationType, n, meanOutcome }) => ({ adaptationType, n, meanOutcome })),
      // Suggested next goals need the AI module; the route may fill them before showing the packet.
      suggestedNextGoals: [],
    }
    const handoff: Handoff = { id: newId(), createdBy: actor.userId, createdAt: at, toSchool: args.toSchool, packet }
    insertEntity(sql, 'handoffs', handoff)
    audit(sql, actor, 'handoffs.create', 'handoffs', handoff.id, undefined, handoff, at)
    return { handoff }
  },
})

export const handoffsGet = defineOp({
  name: 'handoffs.get',
  room: 'student',
  capability: 'progress.view',
  args: StudentArgs.extend({ handoffId: Id }),
  run(sql, args, actor): { handoff: Handoff } {
    const allowed = authorize(actor, 'progress.view', args.studentId)
    if (allowed.filter !== 'all') throw new AltamiraError('forbidden', 'handoffs are for the case manager and teachers')
    const handoff = records.handoffById(sql, args.handoffId)
    if (!handoff) throw new AltamiraError('not_found', `handoff ${args.handoffId} not found`)
    return { handoff }
  },
})

// ---------- voice notes (PRD NFR Consent: converted to metrics, then deleted) ----------

function toEventInput(e: z.infer<typeof VoiceEvent>): EventInput {
  if (e.kind === 'prompt_level' && e.promptLevel) return { kind: 'prompt_level', promptLevel: e.promptLevel }
  if (e.kind === 'counter' && e.count !== null) return { kind: 'counter', count: e.count }
  if (e.kind === 'timer' && e.durationSeconds !== null) return { kind: 'timer', durationSeconds: e.durationSeconds }
  throw new AltamiraError('bad_request', `voice event of kind ${e.kind} is missing its value`)
}

/**
 * Stores the events parsed from a voice note and records that the audio is
 * deleted. The route deletes the stored recording after this op succeeds.
 */
export const voiceNoteProcess = defineOp({
  name: 'voiceNote.process',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend({
    audioFileKey: z.string().min(1),
    classId: Id.nullable().default(null),
    lessonId: Id.nullable().default(null),
    recordedAt: z.string().optional(),
    events: z.array(z.object({ event: VoiceEvent, routing: Routing })),
  }).extend(Now.shape),
  run(sql, args, actor: Actor): { dataPoints: DataPoint[]; audioDeleted: true; skipped: number } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    requireConsent(sql, 'audio')
    const at = nowIso(args.now)
    const dataPoints: DataPoint[] = []
    let skipped = 0
    for (const { event, routing } of args.events) {
      if (!event.objectiveId) {
        skipped++
        continue
      }
      const objective = requireObjective(sql, event.objectiveId)
      const { dataPoint } = storeScoredPoint(
        sql,
        actor,
        {
          objective,
          value: eventValue(toEventInput(event), objective),
          aiConfidence: event.confidence,
          routing,
          sourceRef: eaEventRef(event.kind, `voice-${newId()}`),
          source: EVENT_SOURCE,
          classId: args.classId,
          lessonId: args.lessonId,
          recordedAt: args.recordedAt ?? at,
        },
        at,
      )
      dataPoints.push(dataPoint)
    }
    audit(sql, actor, 'voice_notes.audio_deleted', 'data_points', args.audioFileKey, undefined, { events: dataPoints.length }, at)
    return { dataPoints, audioDeleted: true, skipped }
  },
})

export const familyOpList = [
  consentsSet,
  consentsList,
  parentInputCreate,
  parentInputList,
  familyProgress,
  familySummariesSave,
  familySummariesApprove,
  todayViewGet,
  handoffsCreate,
  handoffsGet,
  voiceNoteProcess,
]
