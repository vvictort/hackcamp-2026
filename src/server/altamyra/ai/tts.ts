import { generate, GeminiError } from './providers/gemini'

/**
 * Gemini text-to-speech through AI Studio REST (fetch, no SDK). Returns a WAV
 * file. Models are tried in order with the same fall-over rules as the text chain.
 */

export const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview']
export const TTS_TIMEOUT_MS = 25_000
export const TTS_TOTAL_TIMEOUT_MS = 40_000
const VOICE = 'Kore'

export type TtsEnv = { GEMINI_API_KEY?: string }

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
  try {
    return await generate({
      apiKey: key,
      models: TTS_MODELS,
      timeoutMs: opts.timeoutMs ?? TTS_TIMEOUT_MS,
      totalTimeoutMs: opts.totalTimeoutMs ?? TTS_TOTAL_TIMEOUT_MS,
      fetch: opts.fetch,
      parts: [{ text }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      read: (parts) => {
        const inline = parts.find((p) => p.inlineData?.data)?.inlineData
        if (!inline?.data) throw new GeminiError('Gemini returned no audio')
        const bytes = fromBase64(inline.data)
        const mime = (inline.mimeType ?? '').toLowerCase()
        if (mime.includes('wav')) return bytes
        return pcmToWav(bytes, Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000))
      },
    })
  } catch {
    return null
  }
}
