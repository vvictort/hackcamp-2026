import { describe, expect, it, vi } from 'vitest'
import { pcmToWav, synthesizeSpeech } from './tts'

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
const audio = (mimeType: string, bytes = [1, 2, 3, 4]) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: b64(bytes) } }] } }] }), { status: 200 })
const asFetch = (f: unknown) => f as typeof fetch

describe('synthesizeSpeech', () => {
  it('returns null with no key and never calls fetch', async () => {
    const f = vi.fn()
    expect(await synthesizeSpeech('hi', {}, { fetch: asFetch(f) })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('wraps PCM in a WAV header', async () => {
    const out = await synthesizeSpeech('hi', { GEMINI_API_KEY: 'k' }, { fetch: asFetch(async () => audio('audio/L16;codec=pcm;rate=24000')) })
    expect(String.fromCharCode(...out!.slice(0, 4))).toBe('RIFF')
    expect(out!.length).toBe(48)
  })

  it('passes WAV through, and falls over 404 to the next model', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 404 })).mockResolvedValueOnce(audio('audio/wav', [9, 9]))
    const out = await synthesizeSpeech('hi', { GEMINI_API_KEY: 'k', ALTAMIRA_GEMINI_TTS_MODELS: 'a,b' }, { fetch: asFetch(f) })
    expect([...out!]).toEqual([9, 9])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('returns null when every model fails or the key is refused', async () => {
    const f = vi.fn(async () => new Response('x', { status: 503 }))
    expect(await synthesizeSpeech('hi', { GEMINI_API_KEY: 'k', ALTAMIRA_GEMINI_TTS_MODELS: 'a,b' }, { fetch: asFetch(f) })).toBeNull()
    expect(f).toHaveBeenCalledTimes(2)
    const f403 = vi.fn(async () => new Response('x', { status: 403 }))
    expect(await synthesizeSpeech('hi', { GEMINI_API_KEY: 'k' }, { fetch: asFetch(f403) })).toBeNull()
    expect(f403).toHaveBeenCalledTimes(1)
  })

  it('header length fields match', () => {
    const w = pcmToWav(new Uint8Array(10))
    expect(new DataView(w.buffer).getUint32(40, true)).toBe(10)
  })
})

describe('synthesizeSpeech output', () => {
  it('reads the sample rate from the mime type and writes a valid 16-bit mono WAV', async () => {
    const out = await synthesizeSpeech('hi', { GEMINI_API_KEY: 'k' }, { fetch: asFetch(async () => audio('audio/L16;codec=pcm;rate=16000', [1, 0, 2, 0])) })
    const v = new DataView(out!.buffer)
    const tag = (o: number) => String.fromCharCode(...out!.slice(o, o + 4))
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(v.getUint32(4, true)).toBe(36 + 4)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(34, true)).toBe(16)
    expect([...out!.slice(44)]).toEqual([1, 0, 2, 0])
  })

  it('falls over from a timed-out model to the next one', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort')))))
    f.mockImplementationOnce(f.getMockImplementation()!)
    const second = vi.fn(async () => audio('audio/wav', [7]))
    let n = 0
    const fetcher = (u: string, init: RequestInit) => (n++ === 0 ? f(u, init) : second())
    const out = await synthesizeSpeech('hi', { GEMINI_API_KEY: 'k', ALTAMIRA_GEMINI_TTS_MODELS: 'a,b' }, { fetch: asFetch(fetcher), timeoutMs: 20 })
    expect([...out!]).toEqual([7])
  })
})
