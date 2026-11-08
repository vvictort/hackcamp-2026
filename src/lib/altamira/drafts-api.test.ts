import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import { ApiError, approveFamilySummary, createDraft, createTodayLink, getTodayView, patchDraft, setConsent, todayUrl } from './drafts-api'

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('drafts-api', () => {
  const fetchMock = vi.fn()
  beforeEach(() => vi.stubGlobal('fetch', fetchMock))
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('sends bearer token and JSON body when creating a draft', async () => {
    fetchMock.mockResolvedValue(ok({ draft: { id: 'd1' } }, 201))
    await createDraft('s 1', { goalId: 'g1', period: 'Term 1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/students/s%201/drafts')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ goalId: 'g1', period: 'Term 1', dueDate: null })
  })

  it('patches with expectedVersion', async () => {
    fetchMock.mockResolvedValue(ok({ draft: {} }))
    await patchDraft('d1', [{ text: 'x', citations: ['p1'] }], 3)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sentences: [{ text: 'x', citations: ['p1'] }], expectedVersion: 3 })
  })

  it('omits text on approve when not edited', async () => {
    fetchMock.mockResolvedValue(ok({ summary: {} }))
    await approveFamilySummary('f1', 2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedVersion: 2 })
  })

  it('PUTs consents', async () => {
    fetchMock.mockResolvedValue(ok({ consents: [] }))
    await setConsent('s1', { kind: 'audio', granted: true })
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/family/s1/consents')
  })

  it('public today view sends no Authorization header', async () => {
    fetchMock.mockResolvedValue(ok({ firstName: 'A' }))
    await getTodayView('abc')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('maps error body and status to ApiError', async () => {
    fetchMock.mockResolvedValue(ok({ error: { code: 'expired', message: 'Link expired' } }, 410))
    await expect(getTodayView('x')).rejects.toMatchObject({ status: 410, code: 'expired', message: 'Link expired' })
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await expect(createTodayLink('s1')).rejects.toBeInstanceOf(ApiError)
  })

  it('builds today url', () => {
    expect(todayUrl('t1', 'http://h')).toBe('http://h/today/t1')
  })
})
