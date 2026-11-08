import type { PlansTodayResponse } from '@/server/altamyra/contract/plans'
import { ApiError, apiFetch, enc } from './api'

export type PlanStatus = 'draft' | 'approved'
export type ProposedChange = { id: string; text: string; label?: string; accepted: boolean }
export type LessonPlan = {
  id: string
  studentId: string
  date: string
  title: string
  originalText: string
  proposed: ProposedChange[]
  tailoredText: string
  status: PlanStatus
  approvedBy: string | null
  approvedAt: string | null
  version: number
}
export type TodayPlans = PlansTodayResponse

export const getTodayPlans = () => apiFetch<TodayPlans>('/lesson-plans/today')
export const getStudentPlans = (studentId: string, date?: string) =>
  apiFetch<{ plans: LessonPlan[] }>(`/students/${enc(studentId)}/lesson-plans`, { query: { date } })
/** Create returned 409: the student already has a plan for that day. Show the existing one instead. */
export class PlanConflictError extends ApiError {
  constructor(code: string, message: string) {
    super(409, code, message)
    this.name = 'PlanConflictError'
  }
}
export const createPlan = async (studentId: string, body: { title: string; text: string; date?: string }) => {
  try {
    return await apiFetch<{ plan: LessonPlan }>(`/students/${enc(studentId)}/lesson-plans`, { method: 'POST', body })
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new PlanConflictError(e.code, e.message)
    throw e
  }
}
export type PlanPatch = { title?: string; originalText?: string; proposed?: ProposedChange[]; tailoredText?: string }
export const updatePlan = (planId: string, studentId: string, version: number, patch: PlanPatch) =>
  apiFetch<{ plan: LessonPlan }>(`/lesson-plans/${enc(planId)}`, { method: 'PATCH', body: { studentId, version, ...patch } })
export const approvePlan = (planId: string, studentId: string, version: number) =>
  apiFetch<{ plan: LessonPlan }>(`/lesson-plans/${enc(planId)}/approve`, { method: 'POST', body: { studentId, version } })

/** The plan to show: the approved one if any, else the newest by version. */
export function pickPlan(plans: LessonPlan[]): LessonPlan | null {
  if (plans.length === 0) return null
  const approved = plans.filter((p) => p.status === 'approved')
  const pool = approved.length ? approved : plans
  return [...pool].sort((a, b) => b.version - a.version)[0]
}

/** Students that still need a plan today. */
export const missingPlan = (t: TodayPlans | null | undefined): Set<string> =>
  new Set((t?.students ?? []).filter((x) => x.plan === null).map((x) => x.studentId))

export const toggleChange = (list: ProposedChange[], id: string): ProposedChange[] =>
  list.map((c) => (c.id === id ? { ...c, accepted: !c.accepted } : c))
export const editChange = (list: ProposedChange[], id: string, text: string): ProposedChange[] =>
  list.map((c) => (c.id === id ? { ...c, text } : c))

/** Proposed changes the teacher accepted, in order. */
export const acceptedChanges = (list: ProposedChange[]): ProposedChange[] => list.filter((c) => c.accepted)

/** Plans can be approved when a tailored text exists and the plan is not approved already. */
export const canApprove = (p: Pick<LessonPlan, 'status' | 'tailoredText'>): boolean => p.status !== 'approved' && p.tailoredText.trim().length > 0

/** Title for a new plan: first non-empty line of the text, trimmed to 60 chars. */
export function titleFromText(text: string, fallback: string): string {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean)
  if (!first) return fallback
  return first.length > 60 ? `${first.slice(0, 57)}...` : first
}
