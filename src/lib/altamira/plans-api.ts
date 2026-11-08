import { apiFetch } from './students-api'

const seg = encodeURIComponent

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
export type TodayPlans = { date: string; students: { studentId: string; label: string; plan: null | { id: string; title: string; status: PlanStatus } }[] }

export const getTodayPlans = () => apiFetch<TodayPlans>('/lesson-plans/today')
export const getStudentPlans = (studentId: string, date?: string) =>
  apiFetch<{ plans: LessonPlan[] }>(`/students/${seg(studentId)}/lesson-plans`, { query: { date } })
export const createPlan = (studentId: string, body: { title: string; text: string; date?: string }) =>
  apiFetch<{ plan: LessonPlan }>(`/students/${seg(studentId)}/lesson-plans`, { method: 'POST', body })
export type PlanPatch = { title?: string; originalText?: string; proposed?: ProposedChange[]; tailoredText?: string }
export const updatePlan = (planId: string, studentId: string, version: number, patch: PlanPatch) =>
  apiFetch<{ plan: LessonPlan }>(`/lesson-plans/${seg(planId)}`, { method: 'PATCH', body: { studentId, version, ...patch } })
export const approvePlan = (planId: string, studentId: string, version: number) =>
  apiFetch<{ plan: LessonPlan }>(`/lesson-plans/${seg(planId)}/approve`, { method: 'POST', body: { studentId, version } })

/** Local calendar date as YYYY-MM-DD (not UTC, so evenings stay on the school day). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

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
