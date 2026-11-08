import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: async () => 'tok' }))
import { ApiError, FAMILY_CONSENT_KINDS, setConsent } from './family-api'

afterEach(() => vi.unstubAllGlobals())

describe('family api', () => {
  it('offers only voice note and video consent', () => {
    expect([...FAMILY_CONSENT_KINDS]).toEqual(['voice_note', 'video'])
  })
  it('puts a consent toggle with the bearer', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ consents: [] }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    await setConsent('s 1', { kind: 'video', granted: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/family/s%201/consents')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })
  it('throws ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'no' } }), { status: 403 })))
    await expect(setConsent('s', { kind: 'video', granted: true })).rejects.toBeInstanceOf(ApiError)
  })
})
