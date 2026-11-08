import { getAuthToken } from 'deepspace'
import type { MeResponse } from '@/server/altamyra/contract/api'

export type { MeResponse }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const enc = encodeURIComponent

const BASE = '/api/v1'

type Query = Record<string, string | undefined>

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) qs.set(k, v)
  const s = qs.toString()
  return `${BASE}${path}${s ? `?${s}` : ''}`
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken().catch(() => null)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  timeoutMs?: number
}

export async function apiFetch<T>(path: string, { method, body, query, timeoutMs }: ApiOptions = {}): Promise<T> {
  const hasBody = body !== undefined
  const headers = await authHeaders()
  if (hasBody) headers['Content-Type'] = 'application/json'
  const ctl = new AbortController()
  const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : undefined
  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method: method ?? (hasBody ? 'POST' : 'GET'),
      credentials: 'include',
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    })
  } catch {
    throw ctl.signal.aborted
      ? new ApiError(0, 'timeout', 'The request took too long. Try again, or paste the text instead of uploading a PDF.')
      : new ApiError(0, 'network', 'Could not reach the server.')
  } finally {
    clearTimeout(timer)
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status}).`)
  }
  return data as T
}

export const apiGet = <T>(path: string) => apiFetch<T>(path)
export const apiPost = <T>(path: string, body: unknown = {}) => apiFetch<T>(path, { body })

export async function emptyOn404<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return empty
    throw e
  }
}
