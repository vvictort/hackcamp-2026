/**
 * Reads the text of a lesson photo with Gemini (Google AI Studio REST, no SDK).
 * Model chain from ALTAMYRA_GEMINI_MODELS; the next model is tried on 429, 503,
 * 404 or a timeout. Without a key the caller uses a fixed demo text instead.
 * The image holds lesson material, not student data; the text it returns is
 * scrubbed of student names like any other lesson text before analysis.
 */

import { DEFAULT_GEMINI_MODELS } from '../server/altamyra/ai/providers/gemini'

export const ATTEMPT_TIMEOUT_MS = 25_000
const NEXT_STATUS = new Set([429, 503, 404])
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const PROMPT =
  'Transcribe the lesson or worksheet in this image as plain text. Keep the task wording and numbering. Do not add commentary. If the image is not a lesson, reply with an empty string.'

export const modelChain = (list?: string): string[] => {
  const models = (list ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  return models.length ? models : DEFAULT_GEMINI_MODELS.split(',')
}

/** Image bytes as base64 plus a media type; checked before any call. */
export interface LensImage {
  mime: string
  data: string
}

export const MAX_IMAGE_B64 = 4_000_000

export function parseImage(v: unknown): LensImage | null {
  const o = v as { mime?: unknown; data?: unknown } | null
  if (!o || typeof o.mime !== 'string' || typeof o.data !== 'string') return null
  if (!/^image\/(png|jpeg|webp|gif)$/.test(o.mime) || !/^[A-Za-z0-9+/=]+$/.test(o.data) || o.data.length > MAX_IMAGE_B64) return null
  return { mime: o.mime, data: o.data }
}

/** Returns the transcript, or null when every model failed. Never throws. */
export async function transcribeImage(
  env: { GEMINI_API_KEY?: string; ALTAMYRA_GEMINI_MODELS?: string },
  image: LensImage,
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  const key = env.GEMINI_API_KEY?.trim()
  if (!key) return null
  for (const model of modelChain(env.ALTAMYRA_GEMINI_MODELS)) {
    try {
      const res = await doFetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: image.mime, data: image.data } }] }] }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
      if (NEXT_STATUS.has(res.status) || res.status >= 500) continue
      if (!res.ok) return null
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const text = body.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text
      return text?.trim() ? text.trim() : null
    } catch {
      // timeout or network error: next model
    }
  }
  return null
}

/** Shown when no key is set, so an image still starts a demo analysis. */
export const DEMO_IMAGE_TEXT = 'Lesson photo (demo mode, no AI key): students complete the tasks on the worksheet shown, then share one answer with a partner.'
