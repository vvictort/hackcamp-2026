import type { z } from 'zod'
import { useR2Files } from 'deepspace'
import type {
  CaptureBatchResponse as CaptureBatchResponseS,
  CaptureEventBody,
  CaptureEventResponse as CaptureEventResponseS,
  DataPointCorrectBody,
  DataPointResponse as DataPointResponseS,
  PhotoCaptureBody,
  ReviewConfirmBody,
  ReviewQueueResponse as ReviewQueueResponseS,
  VoiceNoteResponse as VoiceNoteResponseS,
} from '@/server/altamyra/contract/api'
import type { MediaRef } from '@/server/altamyra/contract/common'
import { blobToBase64 } from '@/lib/utils'
import { ApiError, apiFetch, enc } from './api'

type Out<S extends z.ZodType> = z.output<S>

/** Sheet codes look like AL-K7Q4L1; anything else is rejected before upload. */
export function normalizeSheetCode(input: string): string | null {
  const v = input.trim().toUpperCase()
  return /^AL-[A-Z0-9]{3,}$/.test(v) ? v : null
}

/** File key the server parses the sheet code from (routes/deps.ts sheetCodeFromFileKey). */
export function photoFileKey(sheetCode: string, now = Date.now(), ext = 'jpg'): string {
  return `captures/${now}/sheet-code-${sheetCode}.${ext}`
}

/**
 * Uploads a capture file into the signed-in user's private DeepSpace storage
 * and resolves with the stored key the Altamyra API records. `key` is the
 * location inside the user's folder (e.g. "captures/…/sheet-code-AL-X.jpg");
 * the resolved stored key is what /api/files serves and what the server's
 * file routes accept.
 */
export type FileUpload = (file: Blob, key: string) => Promise<string>
export function useCaptureUpload(): FileUpload {
  const { upload } = useR2Files()
  return async (file, key) => {
    const r = await upload(file, key.split('/').pop() ?? 'file', { key })
    if (!r.success || !r.key) throw new Error(r.error ?? 'The file could not be uploaded.')
    return r.key
  }
}

export async function photoMedia(file: Blob, storedKey: string): Promise<MediaRef> {
  return { fileKey: storedKey, contentType: file.type || 'image/jpeg', bytesBase64: await blobToBase64(file) }
}

/** Photos uploaded in this browser session, so the review page can show the source image. */
const imageCache = new Map<string, string>()
export const rememberImage = (fileKey: string, dataUrl: string) => void imageCache.set(fileKey, dataUrl)
export const cachedImage = (fileKey: string): string | null => imageCache.get(fileKey) ?? null
export const fileKeyOfSourceRef = (ref: string | null): string | null => ref?.match(/^photo:([^#]+)/)?.[1] ?? null

// ---------- reads ----------

export const getReviewQueue = () => apiFetch<Out<typeof ReviewQueueResponseS>>('/review-queue')
export const getCaptureConsent = (studentId: string) => apiFetch<{ voiceNote: boolean; video: boolean }>(`/students/${enc(studentId)}/capture-consent`)

// ---------- photo capture ----------

export const uploadPhotos = (pages: PhotoCaptureBody['pages']) => apiFetch<Out<typeof CaptureBatchResponseS>>('/captures/photos', { body: { pages } })
export const getBatch = (batchId: string) => apiFetch<Out<typeof CaptureBatchResponseS>>(`/captures/${enc(batchId)}`)

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
  apiFetch<Out<typeof DataPointResponseS>>(`/review-queue/${enc(reviewId)}/confirm`, { body, query: { studentId } })

/** expectedVersion is the data point's version. */
export const correctDataPoint = (studentId: string, dataPointId: string, body: DataPointCorrectBody) =>
  apiFetch<Out<typeof DataPointResponseS>>(`/data-points/${enc(dataPointId)}/correct`, { body, query: { studentId } })

// ---------- EA capture ----------

export const recordEvent = (studentId: string, event: CaptureEventBody) =>
  apiFetch<Out<typeof CaptureEventResponseS>>(`/students/${enc(studentId)}/events`, { body: event })

/** Audio blob, or a text/plain blob for the typed-note fallback. Uploaded first so the server can delete it after conversion (PRD consent). */
export async function sendVoiceNote(studentId: string, audio: Blob, classId: string | null = null, now = Date.now(), upload?: FileUpload) {
  const ext = audio.type.startsWith('text/') ? 'txt' : audio.type.includes('mp4') ? 'm4a' : 'webm'
  const key = `voice/${now}.${ext}`
  const storedKey = upload ? await upload(audio, key) : key
  const media: MediaRef = { fileKey: storedKey, contentType: audio.type || 'audio/webm', bytesBase64: await blobToBase64(audio) }
  return apiFetch<Out<typeof VoiceNoteResponseS>>(`/students/${enc(studentId)}/voice-notes`, { body: { audio: media, classId } })
}

// ---------- typed notes and videos ----------

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024

/** A typed observation, saved to today's record. objectiveId is optional. */
export const sendNote = (studentId: string, text: string, objectiveId: string | null = null) =>
  apiFetch<{ note: { id: string } }>(`/students/${enc(studentId)}/notes`, {
    body: { text: text.trim(), ...(objectiveId ? { objectiveId } : {}) },
  })

export function videoFileKey(now = Date.now(), contentType = 'video/mp4'): string {
  const ext = contentType.includes('quicktime') ? 'mov' : contentType.includes('webm') ? 'webm' : 'mp4'
  return `videos/${now}.${ext}`
}

/** Uploads the video, then registers its stored key. A 403 consent_required means the family has not allowed videos. */
export async function sendVideo(studentId: string, video: Blob, objectiveId: string | null = null, now = Date.now(), upload?: FileUpload) {
  const contentType = video.type || 'video/mp4'
  const key = videoFileKey(now, contentType)
  const fileKey = upload ? await upload(video, key) : key
  return apiFetch<{ video: { id: string } }>(`/students/${enc(studentId)}/videos`, {
    body: { fileKey, contentType, sizeBytes: video.size, ...(objectiveId ? { objectiveId } : {}) },
  })
}

/** Why a capture call failed, in the words the screen shows. */
export function captureErrorKind(err: unknown): 'consent' | 'other' {
  return err instanceof ApiError && err.status === 403 && err.code === 'consent_required' ? 'consent' : 'other'
}

// ---------- last student ----------

const LAST_KEY = 'altamyra.capture.lastStudent'
export function rememberStudent(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    /* storage can be blocked; the page still works */
  }
}
export function lastStudent(): string {
  try {
    return localStorage.getItem(LAST_KEY) ?? ''
  } catch {
    return ''
  }
}
