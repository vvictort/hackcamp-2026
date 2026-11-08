import { getAuthToken } from 'deepspace'
import type { z } from 'zod'
import type {
  GoalStatusResponse,
  IepConfirmBody,
  IepImportResponse,
  MeResponse,
  ObjectiveConfirmBody,
  StudentProfileResponse,
} from '@/server/altamira/contract/api'
import type {
  AimlineResponse,
  DataPointSourceResponse,
  IepConfirmResponse,
  ObjectivesResponse,
  TimelineResponse,
  WhatWorksResponse,
} from '@/server/altamira/contract/api'
import type { Objective } from '@/server/altamira/contract/student'

type R<T extends z.ZodType> = z.infer<T>

/** Fetch helpers for the student profile pages. Same-origin /api/v1, cookies included. */

export const API_BASE = '/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const seg = encodeURIComponent

export function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) qs.set(k, v)
  const s = qs.toString()
  return `${API_BASE}${path}${s ? `?${s}` : ''}`
}

export async function apiFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const hasBody = opts.body !== undefined
  let res: Response
  const token = await getAuthToken().catch(() => null)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (hasBody) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? (hasBody ? 'POST' : 'GET'),
      credentials: 'include',
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server.')
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status}).`)
  }
  return data as T
}

export const getMe = () => apiFetch<MeResponse>('/me')
export const getProfile = (id: string) => apiFetch<StudentProfileResponse>(`/students/${seg(id)}`)

export type IepImportInput = { sourceKind: 'text'; text: string } | { sourceKind: 'pdf'; fileName: string; contentType: string; bytesBase64: string }

export const importIep = (id: string, input: IepImportInput) =>
  apiFetch<IepImportResponse>(`/students/${seg(id)}/iep/import`, {
    body:
      input.sourceKind === 'text'
        ? { sourceKind: 'text', text: input.text }
        : { sourceKind: 'pdf', file: { fileKey: input.fileName, contentType: input.contentType, bytesBase64: input.bytesBase64 } },
  })

export const confirmIep = (id: string, version: number, body: IepConfirmBody) =>
  apiFetch<R<typeof IepConfirmResponse>>(`/students/${seg(id)}/iep/${version}/confirm`, { body })

export const getObjectives = (id: string) => apiFetch<R<typeof ObjectivesResponse>>(`/students/${seg(id)}/objectives`)
export const confirmObjective = (oid: string, studentId: string, body: ObjectiveConfirmBody) =>
  apiFetch<{ objective: Objective }>(`/objectives/${seg(oid)}/confirm`, { body, query: { studentId } })
export const flagObjective = (oid: string, studentId: string, expectedVersion: number, reason: string) =>
  apiFetch<{ objective: Objective }>(`/objectives/${seg(oid)}/flag`, { body: { expectedVersion, reason }, query: { studentId } })

export const getTimeline = (id: string, objectiveId?: string) =>
  apiFetch<R<typeof TimelineResponse>>(`/students/${seg(id)}/timeline`, { query: { objectiveId } })
export const getGoalStatus = (id: string, gid: string) => apiFetch<GoalStatusResponse>(`/students/${seg(id)}/goals/${seg(gid)}/status`)
export const getDataPointSource = (dpid: string, studentId: string) =>
  apiFetch<R<typeof DataPointSourceResponse>>(`/data-points/${seg(dpid)}/source`, { query: { studentId } })
export const getAimline = (id: string, gid: string) => apiFetch<R<typeof AimlineResponse>>(`/students/${seg(id)}/goals/${seg(gid)}/aimline`)
export const getWhatWorks = (id: string) => apiFetch<R<typeof WhatWorksResponse>>(`/students/${seg(id)}/what-works`)

/** Reads a File as base64 without the data: prefix. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
