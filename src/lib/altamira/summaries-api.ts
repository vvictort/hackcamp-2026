/** Summaries client: daily, weekly and monthly summaries and their approval. */
import { ApiError, api, apiGet, apiPost } from './api'

export type SummaryKind = 'daily' | 'weekly' | 'monthly'
export const SUMMARY_KINDS: SummaryKind[] = ['daily', 'weekly', 'monthly']

export type Summary = {
  id: string
  studentId: string
  kind: SummaryKind
  period: string
  status: 'draft' | 'approved'
  text: string
  translatedText?: string | null
  language?: string | null
  version: number
  approvedAt?: string | null
}

const enc = encodeURIComponent

function list(r: unknown): Summary[] {
  if (Array.isArray(r)) return r as Summary[]
  const s = (r as { summaries?: Summary[] } | null)?.summaries
  return Array.isArray(s) ? s : []
}

async function emptyOn404<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return empty
    throw e
  }
}

export const listSummaries = (studentId: string, kind: SummaryKind) =>
  emptyOn404(apiGet<unknown>(`/students/${enc(studentId)}/summaries?kind=${kind}`).then(list), [])

/** Approved weekly summaries for the case manager. */
export const listWeekly = () => emptyOn404(apiGet<unknown>('/me/weekly').then(list), [])

export const generateSummary = (studentId: string, kind: SummaryKind, period?: string) =>
  apiPost<Summary>(`/students/${enc(studentId)}/summaries/generate`, period ? { kind, period } : { kind })

export const saveSummary = (s: Pick<Summary, 'id' | 'studentId' | 'version'>, body: { text: string; translatedText?: string }) =>
  api<Summary>('PATCH', `/summaries/${enc(s.id)}`, { studentId: s.studentId, version: s.version, ...body })

export const approveSummary = (s: Pick<Summary, 'id' | 'studentId' | 'version'>) =>
  apiPost<Summary>(`/summaries/${enc(s.id)}/approve`, { studentId: s.studentId, version: s.version })

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
