import type { z } from 'zod'
import type { PendingSummariesResponse } from '@/server/altamyra/contract/api'
import { apiFetch, emptyOn404, enc } from './api'
import { getDayReview, type DayReview } from './eod-api'
import { getTodayPlans, type TodayPlans } from './plans-api'
import type { AltamyraRole } from './role'

export type PendingSummary = z.output<typeof PendingSummariesResponse>['summaries'][number]
export type Today = { plans: TodayPlans; pending: PendingSummary[]; review: DayReview }

const NO_STUDENTS = { date: '', students: [] }

export const getPendingSummaries = () =>
  emptyOn404(apiFetch<{ summaries: PendingSummary[] }>('/me/summaries/pending').then((r) => r.summaries), [])

/** What a staff home shows today; a missing endpoint reads as empty. Only EAs get the end-of-day review. */
export async function getToday(role: AltamyraRole | null): Promise<Today> {
  const [plans, pending, review] = await Promise.all([
    emptyOn404(getTodayPlans(), NO_STUDENTS),
    getPendingSummaries(),
    role === 'ea' ? emptyOn404(getDayReview(), NO_STUDENTS) : NO_STUDENTS,
  ])
  return { plans, pending, review }
}

/** Students with a draft plan (need approval) and without any plan today. */
export function splitToday(r: TodayPlans) {
  return {
    withPlan: r.students.filter((s) => s.plan),
    missing: r.students.filter((s) => !s.plan),
  }
}

/** Link target for a pending summary. */
export const summaryLink = (s: Pick<PendingSummary, 'id' | 'kind' | 'studentId'>) =>
  `/summaries?id=${enc(s.id)}&kind=${s.kind}&student=${enc(s.studentId)}`

export const reviewProgress = (r: DayReview) => ({
  done: r.students.filter((s) => s.reviewed).length,
  total: r.students.length,
})
