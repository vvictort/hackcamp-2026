import { z } from 'zod'
import { VoiceEvent } from '../contract/ai'
import { Id } from '../contract/common'
import { ConsentKind } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor } from '../contract/permissions'
import type { Consent, DataPoint } from '../contract/student'
import { audit, insertEntity, newId, nowIso, updateVersioned } from '../repos/base'
import { currentConfirmedObjectives } from '../repos/iep'
import * as records from '../repos/records'
import { Now, StudentArgs, authorize, authorizeStaff } from './authz'
import { Routing, eventValue, storeScoredPoint, type EventInput } from './measurement'
import { dayRecordOpList } from './day-record'
import { eaEventRef } from './sources'
import { EVENT_SOURCE, requireConsent } from './student-common'
import { summariesOpList } from './summaries'

/** Consent (parent), voice notes, and the summary and daily-record ops registered with them. */

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

export const familyOpList = [consentsSet, consentsList, voiceNoteProcess, voiceNoteAudioDeleted, ...summariesOpList, ...dayRecordOpList]
