import { z } from 'zod'
import { VoiceEvent } from '../contract/ai'
import { ExpectedVersion, Id } from '../contract/common'
import { ConsentKind } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor } from '../contract/permissions'
import type { Consent, DataPoint, FamilySummary } from '../contract/student'
import { assertVersion, audit, insertEntity, newId, nowIso, updateVersioned } from '../repos/base'
import { currentConfirmedObjectives } from '../repos/iep'
import * as records from '../repos/records'
import { Now, StudentArgs, authorize, authorizeStaff } from './authz'
import { Routing, eventValue, storeScoredPoint, type EventInput } from './measurement'
import { eaEventRef } from './sources'
import { EVENT_SOURCE, requireConsent } from './student-common'

/** Consent (parent), family summaries (EA/teacher write and approve; parents read approved) and voice notes. */

// ---------- consent (PRD NFR Consent) ----------

export const consentsSet = defineOp({
  name: 'consents.set',
  room: 'student',
  capability: 'consent.manage',
  args: StudentArgs.extend({
    kind: ConsentKind,
    granted: z.boolean(),
  }).extend(Now.shape),
  run(sql, args, actor): { consents: Consent[] } {
    // Only the parent or guardian manages consent.
    authorize(actor, 'consent.manage', args.studentId)
    const at = nowIso(args.now)
    if (args.granted) {
      if (!records.activeConsent(sql, args.kind)) {
        const consent: Consent = { id: newId(), kind: args.kind, grantedBy: actor.userId, recordedBy: actor.userId, grantedAt: at, revokedAt: null, version: 1 }
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
    // The parent manages consent; staff in scope read it (voice notes and videos are gated on it).
    if (!can(actor, 'consent.manage', args.studentId).allowed) authorize(actor, 'progress.view', args.studentId)
    return { consents: records.listConsents(sql) }
  },
})

// ---------- summaries (daily, weekly, monthly share one table for now) ----------

/**
 * AI-written summaries start as drafts. Only an EA or the teacher edits and
 * approves them; only approved text reaches a parent or case manager.
 */
export const familySummariesSave = defineOp({
  name: 'familySummaries.save',
  room: 'student',
  capability: 'summary.edit',
  args: StudentArgs.extend({ language: z.string().min(2), text: z.string().min(1) }).extend(Now.shape),
  run(sql, args, actor): { summary: FamilySummary } {
    authorize(actor, 'summary.edit', args.studentId)
    const at = nowIso(args.now)
    const summary: FamilySummary = { id: newId(), language: args.language, text: args.text, status: 'draft', createdAt: at, approvedBy: null, approvedAt: null, version: 1 }
    insertEntity(sql, 'family_summaries', summary)
    audit(sql, actor, 'family_summaries.create', 'family_summaries', summary.id, undefined, summary, at)
    return { summary }
  },
})

export const familySummariesApprove = defineOp({
  name: 'familySummaries.approve',
  room: 'student',
  capability: 'summary.approve',
  args: StudentArgs.extend({ summaryId: Id, text: z.string().min(1).optional() }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { summary: FamilySummary } {
    authorize(actor, 'summary.approve', args.studentId)
    const summary = records.summaryById(sql, args.summaryId)
    if (!summary) throw new AltamiraError('not_found', `family summary ${args.summaryId} not found`)
    assertVersion(summary.version, args.expectedVersion, `family summary ${summary.id}`)
    if (summary.status === 'approved') throw new AltamiraError('bad_request', 'family summary is already approved')
    const at = nowIso(args.now)
    const text = args.text ?? summary.text
    updateVersioned(sql, 'family_summaries', summary.id, summary.version, { text, status: 'approved', approved_by: actor.userId, approved_at: at })
    const next: FamilySummary = { ...summary, text, status: 'approved', approvedBy: actor.userId, approvedAt: at, version: summary.version + 1 }
    audit(sql, actor, 'family_summaries.approve', 'family_summaries', summary.id, summary, next, at)
    return { summary: next }
  },
})

/** EA and teacher see drafts and approved summaries; a parent or case manager sees approved ones only (filtered here, in the room). */
export const familySummariesList = defineOp({
  name: 'familySummaries.list',
  room: 'student',
  capability: 'summary.view',
  args: StudentArgs,
  run(sql, args, actor): { summaries: FamilySummary[] } {
    const allowed = authorize(actor, 'summary.view', args.studentId)
    return { summaries: allowed.filter === 'approved_only' ? records.approvedSummaries(sql) : records.listSummaries(sql) }
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
 * Stores the events parsed from a voice note. Only events for a current,
 * confirmed objective whose metric fits the event are kept (AI output never
 * lands on an objective the case manager has not confirmed); the rest are
 * counted as skipped. The route deletes the recording whatever happens here.
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
  run(sql, args, actor: Actor): { dataPoints: DataPoint[]; skipped: number } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    requireConsent(sql, 'voice_note')
    const at = nowIso(args.now)
    const confirmed = new Map(currentConfirmedObjectives(sql).map((o) => [o.id, o]))
    const dataPoints: DataPoint[] = []
    let skipped = 0
    for (const { event, routing } of args.events) {
      const objective = event.objectiveId ? confirmed.get(event.objectiveId) : undefined
      let value: number
      try {
        if (!objective) throw new AltamiraError('bad_request', 'no confirmed objective for this event')
        value = eventValue(toEventInput(event), objective)
      } catch (err) {
        if (!(err instanceof AltamiraError)) throw err
        skipped++
        continue
      }
      const { dataPoint } = storeScoredPoint(
        sql,
        actor,
        {
          objective,
          value,
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
    audit(sql, actor, 'voice_notes.process', 'data_points', args.audioFileKey, undefined, { events: dataPoints.length, skipped }, at)
    return { dataPoints, skipped }
  },
})

/** Records that the recording was deleted. Called by the route only after the delete succeeded (PRD NFR Consent). */
export const voiceNoteAudioDeleted = defineOp({
  name: 'voiceNote.audioDeleted',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend({ audioFileKey: z.string().min(1), processed: z.boolean() }).extend(Now.shape),
  run(sql, args, actor): { audioDeleted: true } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    audit(sql, actor, 'voice_notes.audio_deleted', 'data_points', args.audioFileKey, undefined, { processed: args.processed }, nowIso(args.now))
    return { audioDeleted: true }
  },
})

export const familyOpList = [
  consentsSet,
  consentsList,
  familySummariesSave,
  familySummariesApprove,
  familySummariesList,
  voiceNoteProcess,
  voiceNoteAudioDeleted,
]
