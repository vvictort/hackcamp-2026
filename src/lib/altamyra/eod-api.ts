/**
 * End-of-day review: client calls and plain step logic. The review walks the
 * children from GET /me/day-review one by one, shows what was logged, lets the
 * actor add a note, approve the drafted daily summary and complete the record.
 */
import type { z } from 'zod'
import type { MyDayReviewResponse } from '@/server/altamyra/contract/api'
import { apiFetch, enc } from './api'

export type DayReview = z.output<typeof MyDayReviewResponse>
export type DayStudent = DayReview['students'][number]
type Row = Record<string, unknown>

export const getDayReview = () => apiFetch<DayReview>('/me/day-review')
export const completeDay = (studentId: string, date: string, note?: string) =>
  apiFetch<unknown>(`/students/${enc(studentId)}/days/${enc(date)}/complete`, { body: note?.trim() ? { note: note.trim() } : {} })

// ---------- step logic ----------

/** Children to walk through: the ones helped today (entries) or not yet reviewed. Already reviewed children are kept so the actor can look back. */
export function stepsFor(students: DayStudent[]): DayStudent[] {
  return students.filter((s) => s.entriesToday > 0 || !s.reviewed)
}

export type Step = { index: number; total: number; finished: boolean }
export function stepAt(index: number, total: number): Step {
  return { index: Math.min(Math.max(index, 0), total), total, finished: index >= total }
}
export const nextStep = (s: Step): Step => stepAt(s.index + 1, s.total)

/** First child still to review, else 0. */
export function firstOpen(steps: DayStudent[]): number {
  const i = steps.findIndex((s) => !s.reviewed)
  return i < 0 ? 0 : i
}

export type EntryGroup = 'data' | 'events' | 'notes' | 'videos' | 'voice'
export type EntryLine = { key: string; group: EntryGroup; text: string }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const words = (s: string) => s.replace(/_/g, ' ')

/** Plain one-line text for every thing logged today, in group order. */
export function dayEntries(day: Record<'dataPoints' | 'events' | 'notes' | 'videos' | 'voiceNotes', Row[]>): EntryLine[] {
  const out: EntryLine[] = []
  day.dataPoints.forEach((r, i) => {
    const v = num(r.value)
    const pending = r.status === 'pending_review'
    out.push({ key: `d${str(r.id) || i}`, group: 'data', text: `${v ?? ''} ${str(r.unit)}${pending ? ' (to confirm)' : ''}`.trim() })
  })
  day.events.forEach((r, i) => {
    const kind = str(r.kind)
    const detail = kind === 'prompt_level' ? words(str(r.promptLevel)) : kind === 'counter' ? `count ${num(r.count) ?? ''}` : kind === 'timer' ? `${num(r.durationSeconds) ?? ''} s` : ''
    out.push({ key: `e${str(r.id) || i}`, group: 'events', text: `${words(kind)} ${detail}`.trim() })
  })
  day.notes.forEach((r, i) => out.push({ key: `n${str(r.id) || i}`, group: 'notes', text: str(r.text) }))
  day.videos.forEach((r, i) => out.push({ key: `v${str(r.id) || i}`, group: 'videos', text: 'Video' }))
  day.voiceNotes.forEach((r, i) => out.push({ key: `w${str(r.id) || i}`, group: 'voice', text: 'Voice note' }))
  return out
}

export function groupEntries(lines: EntryLine[]): { group: EntryGroup; lines: EntryLine[] }[] {
  const order: EntryGroup[] = ['data', 'events', 'notes', 'videos', 'voice']
  return order.map((group) => ({ group, lines: lines.filter((l) => l.group === group) })).filter((g) => g.lines.length > 0)
}
