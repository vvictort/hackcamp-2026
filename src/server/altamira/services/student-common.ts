import type { AdaptationType, DataPointSource, Label } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import type { DataPoint, IepVersion, Objective } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { headDataPoints, toPoints } from '../repos/evidence'
import { currentIep, objectiveById } from '../repos/iep'
import { approvedAdaptations } from '../repos/lens'
import { activeConsent } from '../repos/records'
import type { ConsentKind } from '../contract/enums'
import { baselineOf, progressFraction, whatWorks, type Outcome, type WhatWorksRow } from './analytics'
import { SCHOOL_TIME_ZONE } from './thresholds'

/** Helpers shared by the student-room services. */

const SCHOOL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const SCHOOL_OFFSET = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, timeZoneName: 'longOffset' })

/** The school's calendar date (YYYY-MM-DD) at an instant. */
export const schoolDate = (iso: string): string => SCHOOL_DATE.format(new Date(iso))

/** UTC offset of the school's time zone at an instant, in minutes (e.g. -480 for PST). */
function schoolOffsetMinutes(ms: number): number {
  const name = SCHOOL_OFFSET.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}

/** Start of the school day containing `iso`, as a UTC timestamp (PRD matrix: EA scope is "today"). */
export function dayStart(iso: string): string {
  const midnightUtc = Date.parse(`${schoolDate(iso)}T00:00:00.000Z`)
  return new Date(midnightUtc - schoolOffsetMinutes(midnightUtc) * 60_000).toISOString()
}

export function requireObjective(sql: SqlExecutor, objectiveId: string): Objective {
  const objective = objectiveById(sql, objectiveId)
  if (!objective) throw new AltamiraError('not_found', `objective ${objectiveId} not found`)
  return objective
}

export function requireCurrentIep(sql: SqlExecutor): IepVersion {
  const iep = currentIep(sql)
  if (!iep) throw new AltamiraError('not_found', 'this student has no confirmed IEP')
  return iep
}

/** PRD NFR Consent: student mode and audio need an active parental consent row. */
export function requireConsent(sql: SqlExecutor, kind: ConsentKind) {
  const consent = activeConsent(sql, kind)
  if (!consent) throw new AltamiraError('forbidden', `no active ${kind} consent from a parent or guardian`)
  return consent
}

/**
 * PRD 1A-5 guardrail, decided in code: any change to the learning outcome is a
 * modification, whatever label arrived; a modification is blocked unless the
 * IEP in force authorizes modification for the subject.
 */
export function guardrail(
  changesOutcome: boolean,
  label: Label,
  subject: string,
  modificationSubjects: readonly string[],
): { label: Label; blocked: boolean } {
  const finalLabel: Label = changesOutcome ? 'modification' : label
  const authorized = modificationSubjects.map((s) => s.trim().toLowerCase()).includes(subject.trim().toLowerCase())
  return { label: finalLabel, blocked: finalLabel === 'modification' && !authorized }
}

/** Approved adaptations in force for a lesson, stored on each data point captured in it (PRD 1B "Timeline persistence"). */
export function activeAdaptationIds(sql: SqlExecutor, lessonId: string | null): string[] {
  return lessonId ? approvedAdaptations(sql, lessonId).map((a) => a.id) : []
}

/** Builds a new data point row with defaults; every point keeps a source reference (PRD principle 9). */
export function newDataPoint(
  fields: Pick<DataPoint, 'id' | 'objectiveId' | 'value' | 'unit' | 'source' | 'recorderId' | 'recordedAt' | 'status'> &
    Partial<DataPoint> & { sourceRef: string },
): DataPoint {
  if (!fields.sourceRef) throw new AltamiraError('bad_request', 'every data point needs a source reference')
  return {
    classId: null,
    lessonId: null,
    activeAdaptations: [],
    aiConfidence: null,
    version: 1,
    supersedesId: null,
    reason: null,
    sessionDetail: null,
    ...fields,
  }
}

/** Source of an adult-recorded event (prompt level, counter, timer). The recorder id says who. */
export const EVENT_SOURCE: DataPointSource = 'ea'

/** PRD 1B "What works": outcomes per adaptation type, normalised to progress toward each objective's target. */
export function whatWorksFor(sql: SqlExecutor): WhatWorksRow[] {
  const typeOf = new Map<string, AdaptationType>(
    sql
      .all<{ id: string; adaptation_type: AdaptationType }>("SELECT id, adaptation_type FROM suggestions WHERE kind = 'adaptation'")
      .map((r) => [r.id, r.adaptation_type]),
  )
  const outcomes: Outcome[] = []
  const byObjective = new Map<string, DataPoint[]>()
  for (const p of headDataPoints(sql, { confirmedOnly: true })) {
    if (p.activeAdaptations.length === 0 || p.source === 'teacher') continue
    byObjective.set(p.objectiveId, [...(byObjective.get(p.objectiveId) ?? []), p])
  }
  for (const [objectiveId, points] of byObjective) {
    const objective = objectiveById(sql, objectiveId)
    if (!objective) continue
    const all = toPoints(headDataPoints(sql, { objectiveId, confirmedOnly: true }))
    const baseline = objective.baseline ?? baselineOf(all, objective)
    if (baseline === null) continue
    for (const p of points) {
      const outcome = progressFraction(p.value, baseline, objective.target)
      if (outcome === null) continue
      for (const id of new Set(p.activeAdaptations)) {
        const adaptationType = typeOf.get(id)
        if (adaptationType) outcomes.push({ adaptationType, outcome })
      }
    }
  }
  return whatWorks(outcomes)
}
