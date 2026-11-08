/**
 * Fetch helpers for Progress Drafts, Family Bridge, consents, parent input and
 * Today View over the Altamira /api/v1 backend. Types come from the contract.
 */
import { getAuthToken } from 'deepspace'
import type { z } from 'zod'
import type {
  DraftCreateBody,
  FamilyConsentBody,
  FamilyInputBody,
  MeResponse,
  StudentProfileResponse,
} from '@/server/altamira/contract/api'
import type { Consent, DataPoint, FamilySummary, ParentInput, ProgressDraft, DraftSentence } from '@/server/altamira/contract/student'
import type { FamilyProgressResponse, TodayViewResponse, DataPointSourceResponse } from '@/server/altamira/contract/api'

export type { DraftSentence, ProgressDraft, FamilySummary, Consent, ParentInput, DataPoint, MeResponse, StudentProfileResponse }
export type FamilyProgress = z.infer<typeof FamilyProgressResponse>
export type DataPointSource = z.infer<typeof DataPointSourceResponse>
export type { TodayViewResponse }

export const API_BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface Opts {
  method?: string
  body?: unknown
  /** Public routes (Today View) send no credentials. */
  auth?: boolean
}

export async function api<T>(path: string, { method = 'GET', body, auth = true }: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = await getAuthToken().catch(() => null)
    if (token) headers.Authorization = `Bearer ${token}`
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'network', 'Network error')
  }
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `HTTP ${res.status}`)
  }
  return json as T
}

const enc = encodeURIComponent

export const getMe = () => api<MeResponse>('/me')
export const getProfile = (studentId: string) => api<StudentProfileResponse>(`/students/${enc(studentId)}`)

// ---------- Progress Drafts ----------
export type DraftInput = Pick<DraftCreateBody, 'goalId' | 'period'> & { dueDate?: string | null }
export const createDraft = (studentId: string, body: DraftInput) =>
  api<{ draft: ProgressDraft }>(`/students/${enc(studentId)}/drafts`, { method: 'POST', body: { dueDate: null, ...body } })
export const patchDraft = (draftId: string, studentId: string, sentences: DraftSentence[], expectedVersion: number) =>
  api<{ draft: ProgressDraft }>(`/drafts/${enc(draftId)}?studentId=${enc(studentId)}`, { method: 'PATCH', body: { sentences, expectedVersion } })
export const markDraftUsed = (draftId: string, studentId: string, expectedVersion: number) =>
  api<{ draft: ProgressDraft }>(`/drafts/${enc(draftId)}/mark-used?studentId=${enc(studentId)}`, { method: 'POST', body: { expectedVersion } })
export const getDataPointSource = (dataPointId: string) => api<DataPointSource>(`/data-points/${enc(dataPointId)}/source`)

// ---------- Family Bridge ----------
export const createFamilySummary = (draftId: string, studentId: string, language: string) =>
  api<{ summary: FamilySummary }>(`/drafts/${enc(draftId)}/family-summary?studentId=${enc(studentId)}`, { method: 'POST', body: { language } })
export const approveFamilySummary = (summaryId: string, studentId: string, expectedVersion: number, text?: string) =>
  api<{ summary: FamilySummary }>(`/family-summaries/${enc(summaryId)}/approve?studentId=${enc(studentId)}`, {
    method: 'POST',
    body: text ? { expectedVersion, text } : { expectedVersion },
  })

// ---------- Family view, consents, parent input ----------
export const getFamilyProgress = (studentId: string) => api<FamilyProgress>(`/family/${enc(studentId)}/progress`)
export const setConsent = (studentId: string, body: FamilyConsentBody) =>
  api<{ consents: Consent[] }>(`/family/${enc(studentId)}/consents`, { method: 'PUT', body })
export const sendParentInput = (studentId: string, body: FamilyInputBody) =>
  api<{ input: ParentInput }>(`/family/${enc(studentId)}/input`, { method: 'POST', body })
export const getParentInputs = (studentId: string) => api<{ inputs: ParentInput[] }>(`/students/${enc(studentId)}/parent-input`)

// ---------- Today View ----------
export const createTodayLink = (studentId: string, ttlHours = 12) =>
  api<{ token: string; expiresAt: string }>(`/students/${enc(studentId)}/today-links`, { method: 'POST', body: { ttlHours } })
export const getTodayView = (token: string) => api<TodayViewResponse>(`/today/${enc(token)}`, { auth: false })
export const todayUrl = (token: string, origin = typeof location === 'undefined' ? '' : location.origin) => `${origin}/today/${token}`
