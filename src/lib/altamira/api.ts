/** Small typed fetch client for the Altamira /api/v1 backend. */

import { getAuthToken } from 'deepspace'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const BASE = '/api/v1'

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  // The worker authenticates /api/v1 with the DeepSpace bearer token, not a cookie alone.
  const token = await getAuthToken().catch(() => null)
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(err?.code ?? `http_${res.status}`, err?.message ?? res.statusText, res.status)
  }
  return json as T
}

export const apiGet = <T>(path: string) => api<T>('GET', path)
export const apiPost = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body)

// ---- Response shapes used by the shell (mirror src/server/altamira/contract/api.ts) ----

export type StudentSummary = { id: string; displayToken: string; firstName: string | null; grade: string; roles: string[] }

export type MeResponse = {
  userId: string
  displayName: string | null
  memberships: { role: string; studentId: string | null; classId: string | null; districtId: string | null }[]
  caseload: StudentSummary[]
  students: StudentSummary[]
  classes: { id: string; name: string; subject: string; grade: string }[]
  todaySchedule: {
    classId: string
    className: string
    subject: string
    startsAt: string
    endsAt: string
    studentIds: string[]
    lessonId: string | null
    lessonTitle: string | null
  }[]
  parentOf: string[]
}

export type DigestItem = {
  studentId: string
  decision: { id: string; objectiveId: string; rule: 'below_aimline' | 'above_aimline' | 'data_needed'; firedAt: string }
}
