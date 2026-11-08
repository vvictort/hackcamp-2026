import { apiFetch } from './students-api'

const seg = encodeURIComponent

export type DayCounts = { dataPoints: number; events: number; notes: number; videos: number; voiceNotes: number }
export type DayRow = { date: string; counts: DayCounts; reviewed: boolean }
export type DayDetail = {
  date: string
  dataPoints: { id?: string; value?: number | string; unit?: string; status?: string; recordedAt?: string; reason?: string | null }[]
  events: { id?: string; kind?: string; label?: string; at?: string; text?: string }[]
  notes: { id?: string; text: string; at?: string }[]
  videos: { id?: string; name?: string; url?: string; at?: string }[]
  voiceNotes: { id?: string; transcript?: string; at?: string }[]
  review: { reviewed?: boolean; note?: string | null } | null
  dailySummary: { text: string; status?: string } | null
}
export type StudentSummary = { id?: string; kind: string; text: string; status: 'draft' | 'approved'; periodStart?: string; periodEnd?: string } | null

export const getDays = (studentId: string, from?: string, to?: string) =>
  apiFetch<{ days: DayRow[] }>(`/students/${seg(studentId)}/days`, { query: { from, to } })
export const getDay = (studentId: string, date: string) => apiFetch<DayDetail>(`/students/${seg(studentId)}/days/${seg(date)}`)
export const getWeeklySummary = (studentId: string) =>
  apiFetch<{ summary: StudentSummary }>(`/students/${seg(studentId)}/summaries`, { query: { kind: 'weekly' } })

export const dayTotal = (c: DayCounts): number => c.dataPoints + c.events + c.notes + c.videos + c.voiceNotes

/** Newest day first. */
export const sortDays = (days: DayRow[]): DayRow[] => [...days].sort((a, b) => b.date.localeCompare(a.date))

/** Date range ending at `to` that covers the last `n` days (inclusive), as YYYY-MM-DD. */
export function lastNDays(n: number, to: Date = new Date()): { from: string; to: string } {
  const p = (x: number) => String(x).padStart(2, '0')
  const f = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const start = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1))
  return { from: f(start), to: f(to) }
}

/** Summary visible to the viewer: case managers see approved only. */
export function visibleSummary(s: StudentSummary, canSeeDraft: boolean): StudentSummary {
  if (!s) return null
  return s.status === 'approved' || canSeeDraft ? s : null
}

/** Bar heights (0..1) for the trend strip, oldest first. */
export function trendBars(days: DayRow[]): { date: string; h: number; total: number }[] {
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const max = Math.max(1, ...asc.map((d) => dayTotal(d.counts)))
  return asc.map((d) => ({ date: d.date, total: dayTotal(d.counts), h: dayTotal(d.counts) / max }))
}
