import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import { dayTotal, getDay, getDays, getWeeklySummary, lastNDays, sortDays, trendBars, visibleSummary, type DayRow } from './progress-api'

const row = (date: string, n: number): DayRow => ({ date, reviewed: false, counts: { dataPoints: n, events: 0, notes: 0, videos: 0, voiceNotes: 0 } })
afterEach(() => vi.unstubAllGlobals())

describe('progress-api helpers', () => {
  it('totals and sorts days', () => {
    expect(dayTotal({ dataPoints: 1, events: 2, notes: 3, videos: 4, voiceNotes: 5 })).toBe(15)
    expect(sortDays([row('2026-11-01', 1), row('2026-11-03', 1)])[0].date).toBe('2026-11-03')
  })
  it('computes a range', () => expect(lastNDays(14, new Date(2026, 10, 8))).toEqual({ from: '2026-10-26', to: '2026-11-08' }))
  it('hides drafts from viewers who cannot see them', () => {
    const d = { kind: 'weekly', text: 'x', status: 'draft' as const }
    expect(visibleSummary(d, false)).toBeNull()
    expect(visibleSummary(d, true)).toBe(d)
    expect(visibleSummary({ ...d, status: 'approved' }, false)).not.toBeNull()
    expect(visibleSummary(null, true)).toBeNull()
  })
  it('scales trend bars oldest first', () => {
    const b = trendBars([row('2026-11-02', 4), row('2026-11-01', 2)])
    expect(b.map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02'])
    expect(b[1].h).toBe(1)
    expect(b[0].h).toBe(0.5)
    expect(trendBars([])).toEqual([])
  })
})

describe('progress-api calls', () => {
  it('builds urls', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await getDays('s1', '2026-11-01', '2026-11-08')
    await getDay('s1', '2026-11-08')
    await getWeeklySummary('s1')
    const urls = (f.mock.calls as unknown as [string][]).map((c) => c[0])
    expect(urls).toEqual(['/api/v1/students/s1/days?from=2026-11-01&to=2026-11-08', '/api/v1/students/s1/days/2026-11-08', '/api/v1/students/s1/summaries?kind=weekly'])
  })
})
