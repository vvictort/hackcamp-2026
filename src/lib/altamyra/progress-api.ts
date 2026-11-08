import type { z } from 'zod'
import type { DayDetailResponse } from '@/server/altamyra/contract/api'
import { localDate } from '@/lib/utils'
import { apiFetch, enc } from './api'
import type { Summary } from './summaries-api'

export type DayCounts = { dataPoints: number; events: number; notes: number; videos: number; voiceNotes: number }
export type DayRow = { date: string; counts: DayCounts; reviewed: boolean }
export type DayDetail = z.output<typeof DayDetailResponse>

export const getDays = (studentId: string, from?: string, to?: string) =>
  apiFetch<{ days: DayRow[] }>(`/students/${enc(studentId)}/days`, { query: { from, to } })
export const getDay = (studentId: string, date: string) => apiFetch<DayDetail>(`/students/${enc(studentId)}/days/${enc(date)}`)

export const dayTotal = (c: DayCounts): number => c.dataPoints + c.events + c.notes + c.videos + c.voiceNotes

/** Newest day first. */
export const sortDays = (days: DayRow[]): DayRow[] => [...days].sort((a, b) => b.date.localeCompare(a.date))

/** Date range ending at `to` that covers the last `n` days (inclusive), as YYYY-MM-DD. */
export function lastNDays(n: number, to: Date = new Date()): { from: string; to: string } {
  const start = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1))
  return { from: localDate(start), to: localDate(to) }
}

/** Summary visible to the viewer: case managers see approved only. */
export function visibleSummary(s: Summary | null, canSeeDraft: boolean): Summary | null {
  if (!s) return null
  return s.status === 'approved' || canSeeDraft ? s : null
}

/** Bar heights (0..1) for the trend strip, oldest first. */
export function trendBars(days: DayRow[]): { date: string; h: number; total: number }[] {
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const max = Math.max(1, ...asc.map((d) => dayTotal(d.counts)))
  return asc.map((d) => ({ date: d.date, total: dayTotal(d.counts), h: dayTotal(d.counts) / max }))
}
