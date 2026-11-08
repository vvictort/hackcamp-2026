import { getAuthToken } from 'deepspace'
/**
 * Client calls for EA goals, the demo sample sheet and student mode, over the
 * Altamira /api/v1 routes. Staff calls carry the DeepSpace bearer token; student-mode
 * calls carry the short-lived session token in X-Altamira-Session (never IEP text).
 */
import type { SessionNextResponse } from '@/server/altamira/contract/api'

export const SESSION_HEADER = 'X-Altamira-Session'
const BASE = '/api/v1'

export class PracticeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PracticeApiError'
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, sessionToken?: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (sessionToken) headers[SESSION_HEADER] = sessionToken
  else {
    const token = await getAuthToken().catch(() => null)
    if (token) headers.Authorization = `Bearer ${token}`
  }
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
    throw new PracticeApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`)
  }
  return json as T
}

const enc = encodeURIComponent

// ---------- EA ----------

export type CaptureObjective = { objectiveId: string; metricType: string; unit: string }
/** Goals the caller may record against (ids, metric type, unit). Works for EAs. */
export const getCaptureObjectives = (studentId: string) =>
  call<{ objectives: CaptureObjective[] }>('GET', `/students/${enc(studentId)}/capture-objectives`)

// ---------- demo sample sheet ----------

export type SampleSheet = { code: string; studentId: string; checkId: string }
/** Dev demo only: 404 unless the server runs with ALTAMIRA_DEV_SEED. */
export const createSampleSheet = (studentId: string) => call<SampleSheet>('POST', '/captures/sample-sheet', { studentId })

/** File key for a sample sheet; the server parses the sheet code from it and treats it as a demo. */
export const sampleFileKey = (code: string, now = Date.now()) => `captures/${now}/sample-sheet-code-${code}.png`

// ---------- student mode ----------

export type StudentSession = { sessionId: string; token: string; expiresAt: string }
export const startStudentMode = (studentId: string) => call<StudentSession>('POST', `/students/${enc(studentId)}/student-mode/start`, {})
export const sessionNext = (s: StudentSession) => call<SessionNextResponse>('GET', `/sessions/${enc(s.sessionId)}/next`, undefined, s.token)
export const sessionRespond = (s: StudentSession, body: { itemId: string; response: string; durationMs?: number; readAloudUsed?: boolean }) =>
  call<{ correct: boolean }>('POST', `/sessions/${enc(s.sessionId)}/responses`, body, s.token)
export const sessionProgress = (s: StudentSession) =>
  call<{ goals: { label: string; completed: number; streak: number }[] }>('GET', `/sessions/${enc(s.sessionId)}/progress`, undefined, s.token)

// ---------- symbols ----------

/** Mulberry Symbols bundled in public/symbols/mulberry (CC BY-SA 4.0). */
export const MULBERRY_SYMBOLS = [
  'apple', 'banana', 'cat', 'dog', 'sun', 'water', 'bread', 'milk', 'ball', 'house', 'tree', 'car', 'fish', 'bird', 'drink', 'bear', 'school', 'pencil',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'star', 'heart', 'clock',
] as const

const NUMBER_WORDS: Record<string, string> = { '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten' }

/** Symbol file names whose word appears in the prompt, or whose number does; at most `max`. */
export function symbolsFor(prompt: string, max = 3): string[] {
  const words = prompt.toLowerCase().match(/[a-z]+|\d+/g) ?? []
  const out: string[] = []
  const known = (n: string) => (MULBERRY_SYMBOLS as readonly string[]).includes(n)
  for (const w of words) {
    const base = NUMBER_WORDS[w] ?? (!known(w) && w.endsWith('s') ? w.slice(0, -1) : w)
    if (known(base) && !out.includes(base)) out.push(base)
    if (out.length >= max) break
  }
  return out
}
export const symbolUrl = (name: string) => `/symbols/mulberry/${name}.svg`
