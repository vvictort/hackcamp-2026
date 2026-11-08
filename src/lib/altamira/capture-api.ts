/**
 * Fetch helpers for photo capture, the review queue and EA capture over the
 * Altamira /api/v1 routes. Same-origin, cookies included, JSON bodies.
 * Photos and audio travel inline as base64 (MediaRef.bytesBase64); the server
 * reads a sheet code from the file name ("sheet-code-AL-XXXX").
 */
import type { z } from 'zod'
import type {
  CaptureBatchResponse as CaptureBatchResponseS,
  CaptureEventBody,
  CaptureEventResponse as CaptureEventResponseS,
  DataPointCorrectBody,
  DataPointResponse as DataPointResponseS,
  DataPointSourceResponse as DataPointSourceResponseS,
  MeResponse,
  ObjectivesResponse as ObjectivesResponseS,
  PhotoCaptureBody,
  ReviewConfirmBody,
  ReviewQueueResponse as ReviewQueueResponseS,
  StudentProfileResponse,
  VoiceNoteResponse as VoiceNoteResponseS,
} from '@/server/altamira/contract/api'
import type { MediaRef } from '@/server/altamira/contract/common'

type Out<S extends z.ZodType> = z.output<S>
export const API_BASE = '/api/v1'

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

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`)
  }
  return json as T
}

const enc = encodeURIComponent

// ---------- files ----------

/** Base64 (no data: prefix) of a Blob. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Sheet codes look like AL-K7Q4L1; anything else is rejected before upload. */
export function normalizeSheetCode(input: string): string | null {
  const v = input.trim().toUpperCase()
  return /^AL-[A-Z0-9]{3,}$/.test(v) ? v : null
}

/** File key the server parses the sheet code from (routes/deps.ts sheetCodeFromFileKey). */
export function photoFileKey(sheetCode: string, now = Date.now(), ext = 'jpg'): string {
  return `captures/${now}/sheet-code-${sheetCode}.${ext}`
}

export async function photoMedia(file: Blob, sheetCode: string, now = Date.now()): Promise<MediaRef> {
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  return { fileKey: photoFileKey(sheetCode, now, ext), contentType: file.type || 'image/jpeg', bytesBase64: await blobToBase64(file) }
}

/** Photos uploaded in this browser session, so the review page can show the source image. */
const imageCache = new Map<string, string>()
export const rememberImage = (fileKey: string, dataUrl: string) => void imageCache.set(fileKey, dataUrl)
export const cachedImage = (fileKey: string): string | null => imageCache.get(fileKey) ?? null
export const fileKeyOfSourceRef = (ref: string | null): string | null => ref?.match(/^photo:([^#]+)/)?.[1] ?? null

// ---------- reads ----------

export const getMe = () => request<MeResponse>('GET', '/me')
export const getObjectives = (studentId: string) => request<Out<typeof ObjectivesResponseS>>('GET', `/students/${enc(studentId)}/objectives`)
export const getProfile = (studentId: string) => request<StudentProfileResponse>('GET', `/students/${enc(studentId)}`)
export const getReviewQueue = () => request<Out<typeof ReviewQueueResponseS>>('GET', '/review-queue')
export const getDataPointSource = (studentId: string, dataPointId: string) =>
  request<Out<typeof DataPointSourceResponseS>>('GET', `/data-points/${enc(dataPointId)}/source?studentId=${enc(studentId)}`)

// ---------- photo capture ----------

export const uploadPhotos = (pages: PhotoCaptureBody['pages']) => request<Out<typeof CaptureBatchResponseS>>('POST', '/captures/photos', { pages })
export const getBatch = (batchId: string) => request<Out<typeof CaptureBatchResponseS>>('GET', `/captures/${enc(batchId)}`)

/** Polls until the batch leaves "processing" (or attempts run out; the last batch is returned). */
export async function pollBatch(
  batchId: string,
  opts: { intervalMs?: number; maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Out<typeof CaptureBatchResponseS>> {
  const { intervalMs = 1000, maxAttempts = 30, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts
  let last = await getBatch(batchId)
  for (let i = 1; i < maxAttempts && last.batch.status === 'processing'; i++) {
    await sleep(intervalMs)
    last = await getBatch(batchId)
  }
  return last
}

// ---------- review ----------

/** Confirms the item; pass `value` to confirm with a corrected number. expectedVersion is the review item's version. */
export const confirmReview = (studentId: string, reviewId: string, body: ReviewConfirmBody) =>
  request<Out<typeof DataPointResponseS>>('POST', `/review-queue/${enc(reviewId)}/confirm?studentId=${enc(studentId)}`, body)

/** expectedVersion is the data point's version. */
export const correctDataPoint = (studentId: string, dataPointId: string, body: DataPointCorrectBody) =>
  request<Out<typeof DataPointResponseS>>('POST', `/data-points/${enc(dataPointId)}/correct?studentId=${enc(studentId)}`, body)

// ---------- EA capture ----------

export const recordEvent = (studentId: string, event: CaptureEventBody) =>
  request<Out<typeof CaptureEventResponseS>>('POST', `/students/${enc(studentId)}/events`, event)

/** Audio blob, or a text/plain blob for the typed-note fallback. */
export async function sendVoiceNote(studentId: string, audio: Blob, classId: string | null = null, now = Date.now()) {
  const ext = audio.type.startsWith('text/') ? 'txt' : audio.type.includes('mp4') ? 'm4a' : 'webm'
  const media: MediaRef = { fileKey: `voice/${now}.${ext}`, contentType: audio.type || 'audio/webm', bytesBase64: await blobToBase64(audio) }
  return request<Out<typeof VoiceNoteResponseS>>('POST', `/students/${enc(studentId)}/voice-notes`, { audio: media, classId })
}
