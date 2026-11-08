/**
 * Family view client: the approved summary, progress and consent toggles for a
 * parent's own child, over the Altamira /api/v1 backend.
 */
import { getAuthToken } from 'deepspace'
import type { z } from 'zod'
import type { MeResponse } from '@/server/altamira/contract/api'
import type { FamilyProgressResponse } from '@/server/altamira/contract/api'

export type { MeResponse }
export type FamilyProgress = z.infer<typeof FamilyProgressResponse>

/** Consent kinds a parent controls. Typed locally; the server owns the list. */
export const FAMILY_CONSENT_KINDS = ['voice_note', 'video'] as const
export type FamilyConsentKind = (typeof FAMILY_CONSENT_KINDS)[number]
export type Consent = { kind: string; revokedAt?: string | null }

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

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = await getAuthToken().catch(() => null)
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'network', 'Network error')
  }
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `HTTP ${res.status}`)
  return json as T
}

const enc = encodeURIComponent

export const getMe = () => api<MeResponse>('/me')
export const getFamilyProgress = (studentId: string) => api<FamilyProgress>(`/family/${enc(studentId)}/progress`)
export const setConsent = (studentId: string, body: { kind: FamilyConsentKind; granted: boolean }) =>
  api<{ consents: Consent[] }>(`/family/${enc(studentId)}/consents`, 'PUT', body)
