import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import { fetchTtsAudio } from './tts'

afterEach(() => vi.unstubAllGlobals())

describe('fetchTtsAudio', () => {
  it('posts text and language with the bearer token and returns the blob', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const blob = await fetchTtsAudio('hello', 'fr', 's1', f as unknown as typeof fetch)
    expect(blob?.size).toBe(3)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/tts')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hello', language: 'fr', studentId: 's1' })
  })
  it('returns null on 204, 503 and network errors so the caller falls back to browser speech', async () => {
    for (const make of [() => new Response(null, { status: 204 }), () => new Response('x', { status: 503 })]) {
      expect(await fetchTtsAudio('hi', 'en', undefined, (async () => make()) as unknown as typeof fetch)).toBeNull()
    }
    expect(await fetchTtsAudio('hi', 'en', undefined, (async () => { throw new Error('net') }) as unknown as typeof fetch)).toBeNull()
  })
  it('truncates to 2000 characters', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }))
    await fetchTtsAudio('x'.repeat(3000), 'en', undefined, f as unknown as typeof fetch)
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).text).toHaveLength(2000)
  })
})
