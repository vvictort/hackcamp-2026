import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: async () => null }))
import { getPendingSummaries, getToday, reviewProgress, splitToday, summaryLink } from './home-api'

afterEach(() => vi.unstubAllGlobals())

describe('home api', () => {
  it('splits students with and without a plan', () => {
    const r = splitToday({ date: 'd', students: [{ studentId: 'a', label: 'A', plan: { id: 'p', title: 'T', status: 'draft' } }, { studentId: 'b', label: 'B', plan: null }] })
    expect(r.withPlan.map((s) => s.studentId)).toEqual(['a'])
    expect(r.missing.map((s) => s.studentId)).toEqual(['b'])
  })
  it('treats a missing endpoint as empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    expect((await getToday('ea')).plans.students).toEqual([])
    expect(await getPendingSummaries()).toEqual([])
  })
  it('unwraps pending summaries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ summaries: [{ id: 's', studentId: 'x', label: 'X', kind: 'daily', period: 'p' }] }), { status: 200 })))
    expect(await getPendingSummaries()).toHaveLength(1)
  })
  it('links and counts', () => {
    expect(summaryLink({ id: 'a b', kind: 'weekly', studentId: 's' })).toBe('/summaries?id=a%20b&kind=weekly&student=s')
    expect(reviewProgress({ date: '', students: [{ studentId: 'a', label: 'A', entriesToday: 1, reviewed: true }, { studentId: 'b', label: 'B', entriesToday: 0, reviewed: false }] })).toEqual({ done: 1, total: 2 })
  })
})
