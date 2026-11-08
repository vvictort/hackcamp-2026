/** Home screen data: today's lesson plans, summaries waiting for approval, and the end-of-day count. */
import { ApiError, apiGet } from './api'

export type TodayPlan = { id: string; title: string; status: 'draft' | 'approved' }
export type TodayStudent = { studentId: string; label: string; plan: TodayPlan | null }
export type TodayPlans = { date: string; students: TodayStudent[] }

export type PendingSummary = { id: string; studentId: string; label: string; kind: 'daily' | 'weekly' | 'monthly'; period: string }

export type DayReviewStudent = { studentId: string; label: string; entriesToday: number; reviewed: boolean }
export type DayReview = { date: string; students: DayReviewStudent[] }

/** A missing endpoint (404) or an empty answer becomes `fallback`; any other failure still throws. */
async function orFallback<T>(p: Promise<T | null | undefined>, fallback: T): Promise<T> {
  try {
    return (await p) ?? fallback
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return fallback
    throw e
  }
}

export const getTodayPlans = () =>
  orFallback<TodayPlans>(apiGet<TodayPlans>('/lesson-plans/today'), { date: '', students: [] }).then((r) => ({ ...r, students: r.students ?? [] }))

export const getPendingSummaries = () =>
  orFallback<{ summaries: PendingSummary[] }>(apiGet('/me/summaries/pending'), { summaries: [] }).then((r) => r.summaries ?? [])

export const getDayReview = () =>
  orFallback<DayReview>(apiGet<DayReview>('/me/day-review'), { date: '', students: [] }).then((r) => ({ ...r, students: r.students ?? [] }))

/** Students with a draft plan (need approval) and without any plan today. */
export function splitToday(r: TodayPlans) {
  return {
    withPlan: r.students.filter((s) => s.plan),
    missing: r.students.filter((s) => !s.plan),
  }
}

/** Link target for a pending summary. */
export const summaryLink = (s: Pick<PendingSummary, 'id' | 'kind' | 'studentId'>) =>
  `/summaries?id=${encodeURIComponent(s.id)}&kind=${s.kind}&student=${encodeURIComponent(s.studentId)}`

export const reviewProgress = (r: DayReview) => ({
  done: r.students.filter((s) => s.reviewed).length,
  total: r.students.length,
})
