/**
 * Read-aloud client. Tries POST /api/v1/tts (Gemini audio). On 204/503, any
 * error or no key, falls back to window.speechSynthesis; null when neither exists.
 */
import { getAuthToken } from 'deepspace'

export const TTS_MAX_CHARS = 2000

export type Playback = { via: 'audio' | 'speech'; stop(): void; ended: Promise<void> }

export const canSpeakInBrowser = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

/** Audio blob from the server, or null when the server has none (204, 503, network error). */
export async function fetchTtsAudio(text: string, language: string, studentId?: string, fetchImpl: typeof fetch = fetch): Promise<Blob | null> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await getAuthToken().catch(() => null)
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetchImpl('/api/v1/tts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: text.slice(0, TTS_MAX_CHARS), language, ...(studentId ? { studentId } : {}) }),
    })
    if (res.status !== 200) return null
    const blob = await res.blob()
    return blob.size > 0 ? blob : null
  } catch {
    return null
  }
}

export function speakInBrowser(text: string, language: string): Playback | null {
  if (!canSpeakInBrowser()) return null
  const synth = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(text)
  u.lang = language
  const ended = new Promise<void>((resolve) => {
    u.onend = () => resolve()
    u.onerror = () => resolve()
  })
  synth.cancel()
  synth.speak(u)
  return { via: 'speech', stop: () => synth.cancel(), ended }
}

function playBlob(blob: Blob): Playback {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  let finish: () => void = () => {}
  const ended = new Promise<void>((resolve) => {
    finish = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
  })
  audio.onended = finish
  audio.onerror = finish
  void audio.play().catch(finish)
  return {
    via: 'audio',
    stop: () => {
      audio.pause()
      finish()
    },
    ended,
  }
}

/** Plays the text aloud. Null when neither server audio nor browser speech is available. */
export async function playAloud(text: string, language: string, studentId?: string): Promise<Playback | null> {
  const blob = await fetchTtsAudio(text, language, studentId)
  if (blob && typeof Audio !== 'undefined') return playBlob(blob)
  return speakInBrowser(text, language)
}
