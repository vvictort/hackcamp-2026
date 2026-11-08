import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeDay, dayEntries, firstOpen, groupEntries, nextStep, stepAt, stepsFor, todayLocal } from './eod-api'

vi.mock('deepspace', () => ({ getAuthToken: async () => null }))

const s = (studentId: string, entriesToday: number, reviewed: boolean) => ({ studentId, label: studentId, entriesToday, reviewed })

describe('end-of-day steps', () => {
  it('keeps children with entries or still open', () => {
    expect(stepsFor([s('a', 2, true), s('b', 0, true), s('c', 0, false)]).map((x) => x.studentId)).toEqual(['a', 'c'])
  })
  it('starts on the first unreviewed child', () => {
    expect(firstOpen([s('a', 1, true), s('b', 1, false)])).toBe(1)
    expect(firstOpen([s('a', 1, true)])).toBe(0)
  })
  it('moves forward and finishes', () => {
    let st = stepAt(0, 2)
    expect(st.finished).toBe(false)
    st = nextStep(nextStep(st))
    expect(st).toEqual({ index: 2, total: 2, finished: true })
    expect(nextStep(st).index).toBe(2)
  })
  it('formats the local date', () => expect(todayLocal(new Date(2026, 10, 8))).toBe('2026-11-08'))
})

describe('day entries', () => {
  it('writes plain lines grouped in order', () => {
    const lines = dayEntries({
      dataPoints: [{ id: 'p1', value: 3.456, unit: 'correct', status: 'pending_review' }],
      events: [{ id: 'e1', kind: 'prompt_level', promptLevel: 'partial_physical' }, { kind: 'timer', durationSeconds: 90 }],
      notes: [{ id: 'n1', text: 'Calm today' }],
      videos: [{ id: 'v1' }],
      voiceNotes: [],
    })
    expect(lines.map((l) => l.text)).toEqual(['3.46 correct (to confirm)', 'prompt level partial physical', 'timer 90 s', 'Calm today', 'Video'])
    expect(groupEntries(lines).map((g) => g.group)).toEqual(['data', 'events', 'notes', 'videos'])
  })
})

describe('completeDay', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('posts the optional note to the day route', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await completeDay('st 1', '2026-11-08', ' Good day ')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/students/st%201/days/2026-11-08/complete')
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Good day' })
  })
})
