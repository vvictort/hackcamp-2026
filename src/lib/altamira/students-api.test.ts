import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, buildUrl, confirmObjective, getDataPointSource, getProfile, importIep, listMyProposals } from './students-api'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

describe('students-api', () => {
  it('builds urls and skips empty query values', () => {
    expect(buildUrl('/me/proposals', { status: undefined })).toBe('/api/v1/me/proposals')
    expect(buildUrl('/x', { studentId: 'a b' })).toBe('/api/v1/x?studentId=a+b')
  })

  it('encodes ids and sends credentials on GET', async () => {
    const f = mockFetch(200, { view: 'full' })
    await getProfile('s/1')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/students/s%2F1')
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('GET')
  })

  it('posts JSON for import and adds studentId for objectives', async () => {
    const f = mockFetch(200, {})
    await importIep('s1', { sourceKind: 'text', text: 'hi' })
    await confirmObjective('o1', 's1', { expectedVersion: 2 })
    const a = f.mock.calls[0] as unknown as [string, RequestInit]
    const b = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(a[0]).toBe('/api/v1/students/s1/iep/import')
    expect(JSON.parse(a[1].body as string)).toEqual({ sourceKind: 'text', text: 'hi' })
    expect(b[0]).toBe('/api/v1/objectives/o1/confirm?studentId=s1')
    expect(b[1].method).toBe('POST')
  })

  it('passes status filter and source studentId', async () => {
    const f = mockFetch(200, {})
    await listMyProposals('open')
    await getDataPointSource('d1', 's1')
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/me/proposals?status=open')
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe('/api/v1/data-points/d1/source?studentId=s1')
  })

  it('throws ApiError with server code and message', async () => {
    mockFetch(409, { error: { code: 'version_conflict', message: 'stale' } })
    await expect(getProfile('s1')).rejects.toMatchObject({ status: 409, code: 'version_conflict', message: 'stale' })
  })

  it('maps network failure and non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('x'))))
    await expect(getProfile('s1')).rejects.toBeInstanceOf(ApiError)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(getProfile('s1')).rejects.toMatchObject({ status: 500, code: 'error' })
  })
})
