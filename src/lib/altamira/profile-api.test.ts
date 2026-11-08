import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import { buildProposalBody, createHandoff, getHandoff, importIepTimed, listParentInput, ratingEvent, saveProficiency, suggestProficiency } from './profile-api'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const first = (f: ReturnType<typeof mockFetch>) => f.mock.calls[0] as unknown as [string, RequestInit]

describe('proposals', () => {
  it('maps every form field to its own key', () => {
    const b = buildProposalBody({ target: 'objective', goalId: 'g1', newText: ' Raise target to 80 ', reason: ' Met 3 times ', evidenceIds: ['d1'] })
    expect(b).toEqual({ target: 'objective', change: { newText: 'Raise target to 80', goalId: 'g1', reason: 'Met 3 times' }, evidenceIds: ['d1'] })
  })
  it('leaves out an empty goal and reason', () => {
    expect(buildProposalBody({ target: 'iep', goalId: null, newText: 'x', reason: '  ', evidenceIds: [] }).change).toEqual({ newText: 'x' })
  })
})

describe('quick rating', () => {
  const o = (metricType: string, target = 4) => ({ id: 'o1', metricType, target }) as Parameters<typeof ratingEvent>[0]
  it('uses prompt levels for prompt-level measures', () => {
    expect(ratingEvent(o('prompt_level', 5), 'got_it')).toMatchObject({ kind: 'prompt_level', promptLevel: 'independent', objectiveId: 'o1' })
    expect(ratingEvent(o('prompt_level', 5), 'not_yet')).toMatchObject({ promptLevel: 'model' })
  })
  it('scores rubric and accuracy as a whole-number share of the target', () => {
    expect(ratingEvent(o('rubric', 4), 'got_it')).toMatchObject({ kind: 'counter', count: 4 })
    expect(ratingEvent(o('rubric', 4), 'emerging')).toMatchObject({ count: 2 })
    expect(ratingEvent(o('accuracy', 80), 'not_yet')).toMatchObject({ count: 20 })
  })
  it('cannot rate a timed measure', () => {
    expect(ratingEvent(o('duration'), 'got_it')).toBeNull()
  })
})

describe('proficiency', () => {
  const st = (over: Partial<Parameters<typeof suggestProficiency>[0]>) => ({ baseline: 0, current: 4, target: 4, trend: 0.5, recentCount: 5, latestDecision: null, ...over })
  it('says insufficient evidence with few points', () => {
    expect(suggestProficiency(st({ recentCount: 2 }))).toMatchObject({ level: 'IE', reasons: [{ key: 'few' }] })
  })
  it('maps progress to a level and explains it', () => {
    expect(suggestProficiency(st({ current: 4 })).level).toBe('Proficient')
    expect(suggestProficiency(st({ current: 2 })).level).toBe('Developing')
    expect(suggestProficiency(st({ current: 0.5 })).level).toBe('Emerging')
    expect(suggestProficiency(st({ current: 5 })).level).toBe('Extending')
    expect(suggestProficiency(st({ current: 4, latestDecision: 'below_aimline' })).level).toBe('Developing')
    expect(suggestProficiency(st({})).reasons.length).toBeGreaterThan(1)
  })
  it('posts the level with studentId', async () => {
    const f = mockFetch(201, { rating: {} })
    await saveProficiency('s1', 'g/1', { level: 'Developing', period: '2026-11' })
    const [url, init] = first(f)
    expect(url).toBe('/api/v1/goals/g%2F1/proficiency?studentId=s1')
    expect(JSON.parse(init.body as string)).toEqual({ narrative: null, level: 'Developing', period: '2026-11' })
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })
})

describe('parent input and handoff', () => {
  it('reads parent input', async () => {
    const f = mockFetch(200, { inputs: [] })
    await listParentInput('s1')
    expect(first(f)[0]).toBe('/api/v1/students/s1/parent-input')
  })
  it('creates and opens a handoff', async () => {
    const f = mockFetch(201, { handoff: { id: 'h1' } })
    await createHandoff('s1', 'Ridge High')
    expect(JSON.parse(first(f)[1].body as string)).toEqual({ toSchool: 'Ridge High' })
    const g = mockFetch(200, { handoff: { id: 'h1' } })
    await getHandoff('s1', 'h1')
    expect(first(g)[0]).toBe('/api/v1/handoffs/h1?studentId=s1')
  })
})

describe('importIepTimed', () => {
  it('surfaces a clean 502 message', async () => {
    mockFetch(502, { error: { code: 'ai_unavailable', message: 'The AI service did not answer.' } })
    await expect(importIepTimed('s1', { sourceKind: 'text', text: 'x' })).rejects.toMatchObject({ status: 502, code: 'ai_unavailable' })
  })
  it('times out after 45 s', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))))
    const p = importIepTimed('s1', { sourceKind: 'text', text: 'x' })
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(45_001)
    await assertion
  })
})
