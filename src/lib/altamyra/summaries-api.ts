import type { z } from 'zod'
import type { WeeklySummariesResponse } from '@/server/altamyra/contract/api'
import type { SummaryKind } from '@/server/altamyra/contract/enums'
import type { Summary } from '@/server/altamyra/contract/student'
import { apiFetch, emptyOn404, enc } from './api'

export type { Summary, SummaryKind }
export const SUMMARY_KINDS: SummaryKind[] = ['daily', 'weekly', 'monthly']
export type WeeklySummary = z.output<typeof WeeklySummariesResponse>['summaries'][number]

export const listSummaries = (studentId: string, kind: SummaryKind) =>
  emptyOn404(apiFetch<{ summaries: Summary[] }>(`/students/${enc(studentId)}/summaries`, { query: { kind } }).then((r) => r.summaries), [])

/** Approved weekly summaries for the case manager. */
export const listWeekly = () => emptyOn404(apiFetch<{ summaries: WeeklySummary[] }>('/me/weekly').then((r) => r.summaries), [])

export const generateSummary = (studentId: string, kind: SummaryKind, period?: string) =>
  apiFetch<{ summary: Summary }>(`/students/${enc(studentId)}/summaries/generate`, { body: period ? { kind, period } : { kind } })

export const saveSummary = (summaryId: string, studentId: string, version: number, body: { text: string; translatedText?: string }) =>
  apiFetch<{ summary: Summary }>(`/summaries/${enc(summaryId)}`, { method: 'PATCH', body: { studentId, version, ...body } })

export const approveSummary = (summaryId: string, studentId: string, version: number) =>
  apiFetch<{ summary: Summary }>(`/summaries/${enc(summaryId)}/approve`, { body: { studentId, version } })

/** The newest summary: drafts first, since they are the ones waiting for a decision. */
export function pickCurrent(all: Summary[]): Summary | null {
  const sorted = [...all].sort((a, b) => b.period.localeCompare(a.period))
  return sorted.find((s) => s.status === 'draft') ?? sorted[0] ?? null
}

/** Plain-language audience line for each kind. */
export const AUDIENCE_KEY = {
  daily: 'app.summaries.audience.daily',
  weekly: 'app.summaries.audience.weekly',
  monthly: 'app.summaries.audience.monthly',
} as const
