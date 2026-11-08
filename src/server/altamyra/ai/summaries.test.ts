import { describe, expect, it } from 'vitest'
import { AltamyraError } from '../contract/errors'
import { STUDENT_FIXTURES } from '../fixtures'
import { fixtureRoster, tokenFor } from './fixture-data'
import { AiDeidentificationError, AiOutputError } from './errors'
import {
  createFixtureSummaryProvider,
  createGeminiSummaryProvider,
  createSummaryAi,
  DraftDailyOutput,
  DraftMonthlyFamilyOutput,
  DraftWeeklyOutput,
  summaryProviderFromEnv,
  wordCount,
  type SummaryCall,
  type SummaryProvider,
} from './summaries'
import { fixtureNamesIn } from './test-helpers'

const roster = fixtureRoster()
const kai = STUDENT_FIXTURES[0]
const amara = STUDENT_FIXTURES[1]
const kaiTok = tokenFor(kai.studentId)
const amaraTok = tokenFor(amara.studentId)
const kaiName = kai.iep.sections.student.firstName

function setup(provider: SummaryProvider = createFixtureSummaryProvider()) {
  const calls: SummaryCall[] = []
  return { ai: createSummaryAi({ provider, roster, onCall: (c) => calls.push(c) }), calls }
}

const dailyInput = {
  studentToken: kaiTok,
  date: '2026-11-09',
  dataPoints: [
    { id: 'dp1', objective: 'Reads a 3-sentence passage', value: 4, promptLevel: 'verbal', confirmed: true },
    { id: 'dp2', objective: 'Counts to 20', value: 18, confirmed: true },
    { id: 'dp3', objective: 'SECRET-UNCONFIRMED', value: 1, confirmed: false },
  ],
  events: [{ id: 'ev1', kind: 'prompt_level', text: 'Moved to gestural' }],
  notes: [{ id: 'n1', text: `${kaiName} sat with Priya Sandhu and smiled. Email marcus.tran@sd99.fictional.example` }],
}

describe('draftDailySummary', () => {
  it('fixture output is schema-valid, a draft, within 120 words, and cites input ids', async () => {
    const { ai } = setup()
    const out = await ai.draftDailySummary(dailyInput)
    expect(DraftDailyOutput.safeParse(out).success).toBe(true)
    expect(out.status).toBe('draft')
    expect(out.generatedBy).toBe('ai')
    expect(wordCount(out.text)).toBeLessThanOrEqual(120)
    expect(out.citations).toEqual(expect.arrayContaining(['dp1', 'dp2', 'ev1']))
    expect(out.text).toContain(kaiName)
  })

  it('de-identifies before the provider sees anything', async () => {
    const { ai, calls } = setup()
    await ai.draftDailySummary(dailyInput)
    const sent = JSON.stringify(calls[0].payload)
    expect(fixtureNamesIn(sent)).toEqual([])
    expect(sent).not.toContain('Priya')
    expect(sent).not.toContain('marcus.tran@')
  })

  it('drops unconfirmed points before the provider call and from citations', async () => {
    const { ai, calls } = setup()
    const out = await ai.draftDailySummary(dailyInput)
    expect(JSON.stringify(calls[0].payload)).not.toContain('SECRET-UNCONFIRMED')
    expect(out.citations).not.toContain('dp3')
    expect(out.text).not.toContain('SECRET')
  })

  it('says so when nothing is confirmed', async () => {
    const out = await setup().ai.draftDailySummary({ ...dailyInput, dataPoints: [{ ...dailyInput.dataPoints[2] }], events: [], notes: [] })
    expect(out.text).toMatch(/No confirmed data/)
  })

  it('refuses an unrostered student and a bad input', async () => {
    const { ai, calls } = setup()
    await expect(ai.draftDailySummary({ ...dailyInput, studentToken: 'S-NOPE' })).rejects.toBeInstanceOf(AiDeidentificationError)
    await expect(ai.draftDailySummary({ ...dailyInput, date: 'yesterday' })).rejects.toBeInstanceOf(AltamyraError)
    expect(calls).toHaveLength(0)
  })

  it('rejects provider output that cites an unknown id', async () => {
    const bad: SummaryProvider = { ...createFixtureSummaryProvider(), draftDailySummary: async () => ({ text: 'ok', highlights: [], citations: ['made-up'] }) }
    await expect(setup(bad).ai.draftDailySummary(dailyInput)).rejects.toBeInstanceOf(AiOutputError)
  })
})

describe('draftWeeklyCaseloadSummary', () => {
  const weekly = {
    weekStart: '2026-11-02',
    students: [
      {
        studentRef: kaiTok,
        objectives: [
          { objective: 'Reading', trend: [{ id: 'a1', date: '2026-11-02', value: 2, confirmed: true }, { id: 'a2', date: '2026-11-06', value: 4, confirmed: true }] },
        ],
        notableEvents: [],
      },
      {
        studentRef: amaraTok,
        objectives: [
          { objective: 'Counting', trend: [{ id: 'b1', date: '2026-11-02', value: 10, confirmed: true }, { id: 'b2', date: '2026-11-06', value: 5, confirmed: true }, { id: 'b3', date: '2026-11-05', value: 99, confirmed: false }] },
        ],
        notableEvents: [{ id: 'e1', kind: 'incident' }],
      },
    ],
  }

  it('returns flags per student, keeps studentRef as given, is a draft', async () => {
    const { ai, calls } = setup()
    const out = await ai.draftWeeklyCaseloadSummary(weekly)
    expect(DraftWeeklyOutput.safeParse(out).success).toBe(true)
    expect(out.status).toBe('draft')
    expect(out.perStudent.map((p) => p.studentRef)).toEqual([kaiTok, amaraTok])
    expect(out.perStudent.map((p) => p.flag)).toEqual(['on_track', 'needs_attention'])
    expect(JSON.stringify(calls[0].payload)).not.toContain('99')
    expect(out.citations).not.toContain('b3')
  })
})

describe('draftMonthlyFamilySummary', () => {
  const monthly = {
    month: '2026-11',
    studentToken: kaiTok,
    objectives: [{ objective: 'Reading', points: [{ id: 'p1', date: '2026-11-02', value: 2, confirmed: true }, { id: 'p2', date: '2026-11-27', value: 5, confirmed: true }, { id: 'p3', date: '2026-11-28', value: 0, confirmed: false }] }],
    highlights: [`${kaiName} read to the class`],
  }

  it('drafts warm English text within 200 words, de-identified, confirmed only', async () => {
    const { ai, calls } = setup()
    const out = await ai.draftMonthlyFamilySummary(monthly)
    expect(DraftMonthlyFamilyOutput.safeParse(out).success).toBe(true)
    expect(out.status).toBe('draft')
    expect(out.language).toBe('en')
    expect(wordCount(out.text)).toBeLessThanOrEqual(200)
    expect(out.text).toContain(kaiName)
    expect(out.citations).not.toContain('p3')
    expect(fixtureNamesIn(JSON.stringify(calls[0].payload))).toEqual([])
    expect(calls.map((c) => c.fn)).toEqual(['draftMonthlyFamilySummary'])
  })

  it('translates through the provider for another language, de-identified, and reports the language returned', async () => {
    const base = createFixtureSummaryProvider()
    const provider: SummaryProvider = { ...base, translateSummary: async (i) => ({ language: i.language, text: `[${i.language}] ${i.text}` }) }
    const { ai, calls } = setup(provider)
    const out = await ai.draftMonthlyFamilySummary({ ...monthly, language: 'pa' })
    expect(calls.map((c) => c.fn)).toEqual(['draftMonthlyFamilySummary', 'translateSummary'])
    expect(fixtureNamesIn(JSON.stringify(calls[1].payload))).toEqual([])
    expect(out.language).toBe('pa')
    expect(out.text.startsWith('[pa] ')).toBe(true)
    expect(out.englishText).not.toMatch(/^\[pa\]/)
    expect(out.text).toContain(kaiName)
  })

  it('fixture translation falls back to English and says so', async () => {
    const out = await setup().ai.draftMonthlyFamilySummary({ ...monthly, language: 'fr' })
    expect(out.language).toBe('en')
  })

  it('translateSummary is a draft too', async () => {
    const out = await setup().ai.translateSummary({ text: 'Hello', language: 'fr' })
    expect(out).toMatchObject({ status: 'draft', generatedBy: 'ai' })
  })
})

describe('Gemini summary provider', () => {
  const okBody = (obj: unknown) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) }) as Response

  it('sends the de-identified payload to Gemini and uses the reply', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body))
      return okBody({ text: 'Good day.', highlights: [], citations: ['dp1'] })
    }) as unknown as typeof fetch
    const provider = createGeminiSummaryProvider({ apiKey: 'k', fetch: fetchImpl })
    const out = await setup(provider).ai.draftDailySummary(dailyInput)
    expect(out.text).toBe('Good day.')
    expect(fixtureNamesIn(bodies[0])).toEqual([])
    expect(bodies[0]).not.toContain('SECRET-UNCONFIRMED')
  })

  it('falls back to the fixture when Gemini fails, and without a key', async () => {
    const down = (async () => ({ ok: false, status: 503 }) as Response) as unknown as typeof fetch
    const g = createGeminiSummaryProvider({ apiKey: 'k', fetch: down })
    const out = await setup(g).ai.draftDailySummary(dailyInput)
    expect(out.status).toBe('draft')
    expect(g.lastSource).toBe('fixture')
    expect(summaryProviderFromEnv({}).name).toBe('fixture')
    expect(summaryProviderFromEnv({ GEMINI_API_KEY: 'k' }).name).toBe('gemini')
  })
})
