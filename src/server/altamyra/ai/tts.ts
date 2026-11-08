/**
 * Gemini text-to-speech through AI Studio REST (fetch, no SDK). Returns a WAV
 * file. Models are tried in order with the same fall-over rules as the text chain.
 */
export const DEFAULT_TTS_MODELS = 'gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-3.1-flash-tts-preview'
export const TTS_TIMEOUT_MS = 25_000
export const TTS_TOTAL_TIMEOUT_MS = 40_000
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const VOICE = 'Kore'

export type TtsEnv = { GEMINI_API_KEY?: string; ALTAMYRA_GEMINI_TTS_MODELS?: string }

/** Wraps 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/** WAV bytes, or null when no key is set or every model fails (the client then uses browser speech). */
export async function synthesizeSpeech(
  text: string,
  env: TtsEnv,
  opts: { fetch?: typeof fetch; timeoutMs?: number; totalTimeoutMs?: number } = {},
): Promise<Uint8Array | null> {
  const key = env.GEMINI_API_KEY?.trim()
  if (!key) return null
  const models = (env.ALTAMYRA_GEMINI_TTS_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  const chain = models.length ? models : DEFAULT_TTS_MODELS.split(',')
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const deadline = Date.now() + (opts.totalTimeoutMs ?? TTS_TOTAL_TIMEOUT_MS)
  for (const model of chain) {
    const budget = deadline - Date.now()
    if (budget <= 0) break
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(opts.timeoutMs ?? TTS_TIMEOUT_MS, budget)))
    try {
      const res = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          },
        }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        console.warn(`[altamyra-tts] ${model} ${res.status}`)
        if ([400, 401, 403].includes(res.status)) return null
        continue
      }
      const body = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] }
      const inline = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
      if (!inline?.data) continue
      const bytes = fromBase64(inline.data)
      const mime = (inline.mimeType ?? '').toLowerCase()
      if (mime.includes('wav')) return bytes
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000)
      return pcmToWav(bytes, rate)
    } catch {
      console.warn(`[altamyra-tts] ${model} ${ctrl.signal.aborted ? 'timeout' : 'error'}`)
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}
