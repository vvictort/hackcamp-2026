import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: async () => 'tok' }))
import { approveSummary, listSummaries, pickCurrent, saveSummary, type Summary } from './summaries-api'

afterEach(() => vi.unstubAllGlobals())
const mk = (o: Partial<Summary>) => ({ id: 'i', kind: 'daily', period: '2026-11-01', status: 'approved', text: 't', version: 1, ...o }) as Summary

describe('summaries api', () => {
  it('prefers the newest draft', () => {
    expect(pickCurrent([mk({ id: 'a', period: '2026-11-02' }), mk({ id: 'b', status: 'draft', period: '2026-11-01' })])?.id).toBe('b')
    expect(pickCurrent([])).toBeNull()
  })
  it('sends version with edits and approval', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await saveSummary('x', 's', 3, { text: 'hi' })
    await approveSummary('x', 's', 3)
    const [[u1, i1], [u2, i2]] = f.mock.calls as unknown as [string, RequestInit][]
    expect([u1, i1.method, i1.body]).toEqual(['/api/v1/summaries/x', 'PATCH', JSON.stringify({ studentId: 's', version: 3, text: 'hi' })])
    expect([u2, i2.method]).toEqual(['/api/v1/summaries/x/approve', 'POST'])
  })
  it('lists as empty on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    expect(await listSummaries('s', 'daily')).toEqual([])
  })
})
