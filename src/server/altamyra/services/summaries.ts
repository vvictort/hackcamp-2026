import { z } from 'zod'
import { ExpectedVersion, Id } from '../contract/common'
import { SummaryKind, promptLevelFromValue } from '../contract/enums'
import { AltamyraError } from '../contract/errors'
import { defineOp, type SqlExecutor } from '../contract/ops'
import type { Summary } from '../contract/student'
import { assertVersion, audit, insertEntity, newId, nowIso, updateVersioned } from '../repos/base'
import { headDataPoints } from '../repos/evidence'
import { goalById, objectiveById } from '../repos/iep'
import * as records from '../repos/records'
import { mondayOf } from './analytics'
import { Now, StudentArgs, authorize } from './authz'
import { addDays, categoryOf, dayBounds, rangeBounds } from './day-record'
import { schoolDate } from './student-common'
import { DAY_MS } from './thresholds'

/**
 * Daily, weekly and monthly summaries. HARD RULE: they are written by AI, so a
 * draft is visible to the EA and the teacher only. The list op filters by the
 * viewer's role in the room; only an EA or teacher edits or approves.
 */

// ---------- periods ----------

const PERIOD_FORMAT: Record<SummaryKind, RegExp> = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
  monthly: /^\d{4}-(0[1-9]|1[0-2])$/,
}

/** ISO week of a date, "YYYY-Www". */
export function isoWeekOf(date: string): string {
  const thursday = mondayOf(Date.parse(`${date}T00:00:00.000Z`)) + 3 * DAY_MS
  const year = new Date(thursday).getUTCFullYear()
  const week = 1 + Math.round((thursday - 3 * DAY_MS - mondayOf(Date.UTC(year, 0, 4))) / (7 * DAY_MS))
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Monday of an ISO week, YYYY-MM-DD. */
export function weekStartOf(period: string): string {
  const [y, w] = period.split('-W').map(Number)
  return new Date(mondayOf(Date.UTC(y, 0, 4)) + (w - 1) * 7 * DAY_MS).toISOString().slice(0, 10)
}

/** First and last school date of a period. */
export function periodDates(kind: SummaryKind, period: string): { first: string; last: string } {
  if (kind === 'daily') return { first: period, last: period }
  if (kind === 'weekly') {
    const first = weekStartOf(period)
    return { first, last: addDays(first, 6) }
  }
  const first = `${period}-01`
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10)
  return { first, last }
}

/** The requested period, or the current one; 400 for a malformed period. */
export function resolvePeriod(kind: SummaryKind, period: string | undefined, at: string): string {
  const today = schoolDate(at)
  const value = period ?? (kind === 'daily' ? today : kind === 'weekly' ? isoWeekOf(today) : today.slice(0, 7))
  if (!PERIOD_FORMAT[kind].test(value) || (kind === 'daily' && Number.isNaN(Date.parse(value)))) {
    throw new AltamyraError('bad_request', `period for a ${kind} summary must look like ${kind === 'daily' ? 'YYYY-MM-DD' : kind === 'weekly' ? 'YYYY-Www' : 'YYYY-MM'}`)
  }
  return value
}

// ---------- AI inputs (confirmed data only) ----------

type DayValue = { id: string; date: string; value: number; confirmed: true }

function objectiveName(sql: SqlExecutor, objectiveId: string): string {
  const objective = objectiveById(sql, objectiveId)
  const goal = objective ? goalById(sql, objective.goalId) : undefined
  return (goal?.text ?? goal?.area ?? 'Goal').slice(0, 140)
}

export type SummaryInputs = {
  kind: SummaryKind
  period: string
  existing: { id: string; status: Summary['status'] } | null
  daily: { date: string; dataPoints: { id: string; objective: string; value: number; promptLevel?: string; note?: string; confirmed: true }[]; events: never[]; notes: { id: string; text: string }[] } | null
  weekly: { weekStart: string; objectives: { objective: string; trend: DayValue[] }[]; notableEvents: { id: string; kind: string; text: string; at: string }[] } | null
  monthly: { month: string; objectives: { objective: string; points: DayValue[] }[]; highlights: string[] } | null
}

/** One value per objective and school day (the day's last confirmed point). */
function dailyValues(sql: SqlExecutor, first: string, last: string): { objective: string; values: DayValue[] }[] {
  const { from, to } = rangeBounds(first, last)
  const byObjective = new Map<string, Map<string, DayValue>>()
  for (const p of headDataPoints(sql, { from, to: new Date(Date.parse(to) - 1).toISOString(), confirmedOnly: true })) {
    const days = byObjective.get(p.objectiveId) ?? new Map<string, DayValue>()
    const date = schoolDate(p.recordedAt)
    days.set(date, { id: p.id, date, value: p.value, confirmed: true })
    byObjective.set(p.objectiveId, days)
  }
  return [...byObjective.entries()].map(([objectiveId, days]) => ({
    objective: objectiveName(sql, objectiveId),
    values: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }))
}

/** Only confirmed and auto-confirmed data points go in; unreviewed AI scores never reach a summary. */
export function summaryInputs(sql: SqlExecutor, kind: SummaryKind, period: string): SummaryInputs {
  const found = records.summaryFor(sql, kind, period)
  const base = { kind, period, existing: found ? { id: found.id, status: found.status } : null, daily: null, weekly: null, monthly: null }
  const { first, last } = periodDates(kind, period)
  if (kind === 'daily') {
    const { from, to } = dayBounds(period)
    const dataPoints = headDataPoints(sql, { from, to: new Date(Date.parse(to) - 1).toISOString(), confirmedOnly: true }).map((p) => {
      const eventKind = categoryOf(p) === 'dataPoints' ? undefined : (p.sourceRef ?? '').split(':')[1]
      const level = eventKind === 'prompt_level' ? promptLevelFromValue(p.value) : undefined
      return {
        id: p.id,
        objective: objectiveName(sql, p.objectiveId),
        value: p.value,
        ...(level ? { promptLevel: level } : {}),
        ...(eventKind && eventKind !== 'prompt_level' ? { note: eventKind } : {}),
        confirmed: true as const,
      }
    })
    const notes = records.notesBetween(sql, from, to).map((n) => ({ id: n.id, text: n.text }))
    return { ...base, daily: { date: period, dataPoints, events: [], notes } }
  }
  const series = dailyValues(sql, first, last)
  if (kind === 'weekly') {
    const { from, to } = rangeBounds(first, last)
    const notable = records.notesBetween(sql, from, to).slice(-5).map((n) => ({ id: n.id, kind: 'note', text: n.text, at: n.recordedAt }))
    return { ...base, weekly: { weekStart: first, objectives: series.map((s) => ({ objective: s.objective, trend: s.values })), notableEvents: notable } }
  }
  const days = new Set(series.flatMap((s) => s.values.map((v) => v.date))).size
  return {
    ...base,
    monthly: {
      month: period,
      objectives: series.map((s) => ({ objective: s.objective, points: s.values })),
      highlights: days > 0 ? [`${days} ${days === 1 ? 'day' : 'days'} of learning were recorded`] : [],
    },
  }
}

export const summariesInputs = defineOp({
  name: 'summaries.inputs',
  room: 'student',
  args: StudentArgs.extend({ kind: SummaryKind, period: z.string().optional() }).extend(Now.shape),
  run(sql, args, actor): SummaryInputs {
    authorize(actor, 'summary.edit', args.studentId)
    return summaryInputs(sql, args.kind, resolvePeriod(args.kind, args.period, nowIso(args.now)))
  },
})

// ---------- storing, listing, editing, approving ----------

const audioScriptOf = (kind: SummaryKind, text: string, translatedText: string | null) => (kind === 'monthly' ? (translatedText ?? text) : null)

/** What a viewer without edit rights gets: no internal user ids. */
const forAudience = (s: Summary): Summary => ({ ...s, editedBy: null, approvedBy: null })

/**
 * Stores an AI draft (called by the generate route after the AI call). Replaces
 * the draft of the same period; an approved summary is never replaced silently.
 */
export const familySummariesSave = defineOp({
  name: 'familySummaries.save',
  room: 'student',
  args: StudentArgs.extend({
    kind: SummaryKind.default('monthly'),
    period: z.string().optional(),
    text: z.string().trim().min(1),
    translatedText: z.string().trim().min(1).nullable().default(null),
    language: z.string().min(2).nullable().default(null),
  }).extend(Now.shape),
  run(sql, args, actor): { summary: Summary } {
    authorize(actor, 'summary.edit', args.studentId)
    const at = nowIso(args.now)
    const period = resolvePeriod(args.kind, args.period, at)
    const translatedText = args.kind === 'monthly' ? args.translatedText : null
    const fields = {
      text: args.text,
      translated_text: translatedText,
      language: args.kind === 'monthly' ? args.language : null,
      audio_script: audioScriptOf(args.kind, args.text, translatedText),
      edited_by: null,
    }
    const existing = records.summaryFor(sql, args.kind, period)
    if (existing?.status === 'approved') throw new AltamyraError('bad_request', 'This summary is already approved. Edit it to change it.')
    if (existing) {
      updateVersioned(sql, 'summaries', existing.id, existing.version, fields)
      const summary = records.summaryById(sql, existing.id)
      if (!summary) throw new AltamyraError('not_found', 'summary vanished')
      audit(sql, actor, 'summaries.regenerate', 'summaries', existing.id, { version: existing.version }, { version: summary.version }, at)
      return { summary }
    }
    const summary: Summary = {
      id: newId(),
      kind: args.kind,
      period,
      text: fields.text,
      translatedText,
      language: fields.language,
      audioScript: fields.audio_script,
      status: 'draft',
      editedBy: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: at,
      version: 1,
    }
    insertEntity(sql, 'summaries', summary)
    audit(sql, actor, 'summaries.create', 'summaries', summary.id, undefined, { kind: summary.kind, period, status: 'draft' }, at)
    return { summary }
  },
})

/** EA and teacher edit; editing an approved summary returns it to draft, hidden from its audience again. */
export const summariesEdit = defineOp({
  name: 'summaries.edit',
  room: 'student',
  args: StudentArgs.extend({
    summaryId: Id,
    text: z.string().trim().min(1),
    translatedText: z.string().trim().min(1).nullable().optional(),
    /** Language of translatedText, when the EA or teacher writes or fixes the translation. */
    language: z.string().min(2).max(16).optional(),
    version: z.number().int().min(1),
  }).extend(Now.shape),
  run(sql, args, actor): { summary: Summary } {
    authorize(actor, 'summary.edit', args.studentId)
    const summary = records.summaryById(sql, args.summaryId)
    if (!summary) throw new AltamyraError('not_found', `summary ${args.summaryId} not found`)
    assertVersion(summary.version, args.version, `summary ${summary.id}`)
    if (summary.kind !== 'monthly' && args.translatedText) throw new AltamyraError('bad_request', 'Only a monthly summary has a translation.')
    const at = nowIso(args.now)
    const translatedText = summary.kind === 'monthly' && args.translatedText !== undefined ? args.translatedText : summary.translatedText
    updateVersioned(sql, 'summaries', summary.id, summary.version, {
      text: args.text,
      translated_text: translatedText,
      language: summary.kind === 'monthly' ? (args.language ?? summary.language) : null,
      audio_script: audioScriptOf(summary.kind, args.text, translatedText),
      edited_by: actor.userId,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    })
    const next = records.summaryById(sql, summary.id)
    if (!next) throw new AltamyraError('not_found', 'summary vanished')
    audit(sql, actor, 'summaries.edit', 'summaries', summary.id, { status: summary.status }, { status: 'draft', editedBy: actor.userId }, at)
    return { summary: next }
  },
})

/** The EA or the teacher approves what they saw (text, translation and audio script) at this version. */
export const familySummariesApprove = defineOp({
  name: 'familySummaries.approve',
  room: 'student',
  args: StudentArgs.extend({ summaryId: Id, version: ExpectedVersion.shape.expectedVersion }).extend(Now.shape),
  run(sql, args, actor): { summary: Summary } {
    authorize(actor, 'summary.approve', args.studentId)
    const summary = records.summaryById(sql, args.summaryId)
    if (!summary) throw new AltamyraError('not_found', `summary ${args.summaryId} not found`)
    assertVersion(summary.version, args.version, `summary ${summary.id}`)
    if (summary.status === 'approved') throw new AltamyraError('bad_request', 'This summary is already approved.')
    const at = nowIso(args.now)
    updateVersioned(sql, 'summaries', summary.id, summary.version, { status: 'approved', approved_by: actor.userId, approved_at: at })
    const next: Summary = { ...summary, status: 'approved', approvedBy: actor.userId, approvedAt: at, version: summary.version + 1 }
    audit(sql, actor, 'summaries.approve', 'summaries', summary.id, { status: 'draft' }, { status: 'approved' }, at)
    return { summary: next }
  },
})

/**
 * EA and teacher: drafts and approved summaries of every kind. Case manager:
 * approved weekly summaries only. Parent: approved monthly summaries only.
 * Filtered here, in the room, whatever the route does.
 */
export const familySummariesList = defineOp({
  name: 'familySummaries.list',
  room: 'student',
  args: StudentArgs.extend({ kind: SummaryKind.optional() }),
  run(sql, args, actor): { summaries: Summary[] } {
    const allowed = authorize(actor, 'summary.view', args.studentId)
    if (allowed.filter !== 'approved_only') return { summaries: records.listSummaries(sql, { kind: args.kind }) }
    const audience: SummaryKind = allowed.role === 'parent' ? 'monthly' : 'weekly'
    if (args.kind && args.kind !== audience) return { summaries: [] }
    return { summaries: records.listSummaries(sql, { kind: audience, status: 'approved' }).map(forAudience) }
  },
})

/** Drafts waiting for the EA or teacher. */
export const summariesPending = defineOp({
  name: 'summaries.pending',
  room: 'student',
  args: StudentArgs,
  run(sql, args, actor): { summaries: { id: string; kind: SummaryKind; period: string }[] } {
    authorize(actor, 'summary.edit', args.studentId)
    return { summaries: records.listSummaries(sql, { status: 'draft' }).map((s) => ({ id: s.id, kind: s.kind, period: s.period })) }
  },
})

export const summariesOpList = [summariesInputs, familySummariesSave, summariesEdit, familySummariesApprove, familySummariesList, summariesPending]
