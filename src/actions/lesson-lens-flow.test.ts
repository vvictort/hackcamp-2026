import { describe, expect, it, vi } from 'vitest'
import { lessonLensActions, parseStudents } from './lesson-lens'
import { adaptationTypeFor, decideLabel, rankSuggestions, type LensSuggestionView, type LensWhatWorks } from './lesson-lens-core'
import { modelChain, parseImage, transcribeImage } from './lesson-lens-gemini'

const goal = (id: string, area: string) => ({ id, area, text: `Goal ${id}`, level: '' })
const kai = {
  id: 'kai', firstName: 'Kai', name: 'Kai',
  goals: [goal('g-read', 'Reading'), goal('g-beh', 'Self-regulation')],
  accommodations: ['Extra time'], strengths: ['Drawing'], modificationSubjects: [], whatWorks: [],
}

const tools = () => {
  let n = 0
  return { create: vi.fn(async () => ({ success: true, data: { recordId: `r${++n}` } })), get: vi.fn(), update: vi.fn(), query: vi.fn() }
}
const call = (name: keyof typeof lessonLensActions, params: Record<string, unknown>, t = tools()) =>
  (lessonLensActions[name] as unknown as (a: unknown) => Promise<{ success: boolean; data: any; code?: string }>)({ userId: 'u1', params, tools: t, env: {} })

describe('Lens analyze action (from the /api/v1 caseload)', () => {
  it('runs on students sent from the caseload and links every gap to an IEP goal id', async () => {
    const r = await call('lessonLensAnalyze', { lessonText: 'Read the story and retell it', students: [kai] })
    expect(r.success).toBe(true)
    const st = r.data.students[0]
    expect(st.studentId).toBe('kai')
    expect(st.gaps.length).toBeGreaterThan(0)
    for (const g of st.gaps) expect(['g-read', 'g-beh']).toContain(g.goalId)
    expect(st.gaps.map((g: { type: string }) => g.type)).toEqual(expect.arrayContaining(['skill']))
    expect(st.suggestions.every((s: { label: string }) => s.label === 'adapt' || s.label === 'modify')).toBe(true)
    expect(st.checks.every((c: { code: string }) => /^G\d+-C\d+$/.test(c.code))).toBe(true)
  })

  it('returns the cached analysis for the same lesson, and only then', async () => {
    const t = tools()
    const p = { lessonText: 'Cache me: arrays', students: [kai] }
    const first = await call('lessonLensAnalyze', p, t)
    const second = await call('lessonLensAnalyze', { ...p, lessonText: '  CACHE ME:  arrays ' }, t)
    expect(first.data.cached).toBe(false)
    expect(second.data.cached).toBe(true)
    expect(t.create).toHaveBeenCalledTimes(first.data.students[0].suggestions.length)
    const other = await call('lessonLensAnalyze', { ...p, lessonText: 'A different lesson' }, t)
    expect(other.data.cached).toBe(false)
  })

  it('starts from an image: demo text without an AI key, and no students is an error', async () => {
    const img = { mime: 'image/jpeg', data: 'AAAA' }
    const r = await call('lessonLensAnalyze', { image: img, students: [kai] })
    expect(r.success).toBe(true)
    expect(r.data.lessonText).toMatch(/demo mode/)
    expect((await call('lessonLensAnalyze', { lessonText: 'x', students: [] })).code).toBe('no_students')
    expect((await call('lessonLensAnalyze', { students: [kai] })).code).toBe('bad_request')
  })

  it('ignores malformed student payloads and clips sizes', () => {
    expect(parseStudents('x')).toEqual([])
    const out = parseStudents([{ id: 'a', goals: [{ id: 'g', text: 'ok', area: 'Math' }], whatWorks: [{ adaptationType: 'nope', n: 1 }, { adaptationType: 'chunked_steps', n: 3, meanOutcome: 0.8, hidden: false }] }, { id: 'b', goals: [] }, null])
    expect(out).toHaveLength(1)
    expect(out[0].whatWorks).toHaveLength(1)
  })
})

describe('guardrail with the IEP basis', () => {
  const sam = { goals: [goal('g', 'Math')], modificationSubjects: ['math'] }
  it('modify needs an IEP basis for the subject', () => {
    expect(decideLabel({ kind: 'modification', text: 'Shorter task' }, sam, 'math')).toBe('modify')
    expect(decideLabel({ kind: 'modification', text: 'Shorter task' }, sam, 'reading')).toBe('adapt')
    expect(decideLabel({ kind: 'modification', text: 'Shorter task' }, { goals: [goal('g', 'Math')] }, 'math')).toBe('adapt')
  })
})

describe('1A-9 learn from outcomes', () => {
  const view = (id: string, text: string): LensSuggestionView => ({ id, goalId: 'g', label: 'adapt', adaptationType: adaptationTypeFor(text), text, why: 'w', state: 'pending' })
  const ww: LensWhatWorks[] = [
    { adaptationType: 'sentence_frames', n: 6, meanOutcome: 0.8, hidden: false },
    { adaptationType: 'chunked_steps', n: 5, meanOutcome: 0.2, hidden: false },
    { adaptationType: 'visual_supports', n: 1, meanOutcome: 0.95, hidden: true },
  ]
  it('maps wording to an adaptation type', () => {
    expect(adaptationTypeFor('Break it into steps')).toBe('chunked_steps')
    expect(adaptationTypeFor('Use sentence frames for answers')).toBe('sentence_frames')
    expect(adaptationTypeFor('Add a diagram')).toBe('visual_supports')
    expect(adaptationTypeFor('x', 'modify')).toBe('modified_assessment')
  })
  it('ranks strategies with good outcomes first and flags them; hidden or weak rows do not count', () => {
    const out = rankSuggestions([view('1', 'Break it into steps'), view('2', 'Add a diagram'), view('3', 'Use sentence frames')], ww)
    expect(out.map((s) => s.id)).toEqual(['3', '1', '2'])
    expect(out.map((s) => !!s.workedBefore)).toEqual([true, false, false])
  })
  it('keeps order with no history', () => {
    expect(rankSuggestions([view('1', 'a'), view('2', 'b')], []).map((s) => s.id)).toEqual(['1', '2'])
  })
})

describe('Gemini image reading', () => {
  it('uses the configured chain and moves on after 429, 503, 404 and a timeout', async () => {
    const seen: string[] = []
    const codes = [429, 503, 404]
    const f = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url))
      const c = codes.shift()
      if (c) return new Response('{}', { status: c })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: ' Page 1 ' }] } }] }), { status: 200 })
    })
    const text = await transcribeImage({ GEMINI_API_KEY: 'k', ALTAMIRA_GEMINI_MODELS: 'm1,m2,m3,m4' }, { mime: 'image/png', data: 'AA' }, f as unknown as typeof fetch)
    expect(text).toBe('Page 1')
    expect(seen.map((u) => /models\/(m\d)/.exec(u)![1])).toEqual(['m1', 'm2', 'm3', 'm4'])
  })
  it('returns null without a key and validates images', async () => {
    expect(await transcribeImage({}, { mime: 'image/png', data: 'AA' })).toBeNull()
    expect(parseImage({ mime: 'text/html', data: 'AA' })).toBeNull()
    expect(parseImage({ mime: 'image/png', data: 'AA' })).toEqual({ mime: 'image/png', data: 'AA' })
    expect(modelChain('')[0]).toBe('gemini-3.8-flash')
  })
})

describe('1A-9 worked-before from What works rows (mocked API shape)', () => {
  const rows = { rows: [{ adaptationType: 'chunked_steps', n: 4, meanOutcome: 0.9, hidden: false }, { adaptationType: 'visual_supports', n: 1, meanOutcome: 0.9, hidden: true }] }
  it('parseStudents keeps visible rows and the analysis puts the matching strategy first with the flag', async () => {
    const [st] = parseStudents([{ ...kai, whatWorks: rows.rows }])
    expect((st.whatWorks ?? []).map((r) => r.adaptationType)).toEqual(expect.arrayContaining(['chunked_steps']))
    const r = await call('lessonLensAnalyze', { lessonText: 'Read the story and retell it', students: [{ ...kai, whatWorks: rows.rows }] })
    const list = r.data.students[0].suggestions as { adaptationType: string; workedBefore?: boolean }[]
    const flagged = list.filter((s) => s.workedBefore)
    for (const s of flagged) expect(s.adaptationType).toBe('chunked_steps')
    // Flagged suggestions come before every unflagged one.
    const firstUnflagged = list.findIndex((s) => !s.workedBefore)
    if (firstUnflagged >= 0) expect(list.slice(firstUnflagged).some((s) => s.workedBefore)).toBe(false)
  })
})
