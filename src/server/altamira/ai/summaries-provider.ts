import type { z } from 'zod'
import { AiNotConfiguredError, AiOutputError } from './errors'
import { parseJsonLoose, parseModels, GEMINI_TIMEOUT_MS, GEMINI_TOTAL_TIMEOUT_MS, GeminiError, type GeminiEnv } from './providers/gemini'
import { coerceToSchema, toGeminiSchema } from './providers/gemini-schema'
import {
  DraftDailyInput,
  DraftDistrictInput,
  DraftMonthlyFamilyInput,
  DraftWeeklyInput,
  TranslateSummaryInput,
  DraftDailyModelOutput,
  DraftDistrictModelOutput,
  DraftMonthlyFamilyModelOutput,
  DraftWeeklyModelOutput,
  TranslateSummaryModelOutput,
} from './summaries-schemas'

/**
 * Providers for the summary drafts. Inputs are already de-identified and
 * schema-parsed (createSummaryAi does that). Outputs carry no status: the
 * caller stamps 'draft' / 'ai'.
 */

type Parsed<T extends z.ZodType> = z.output<T>
export type SummaryName = 'draftDailySummary' | 'draftWeeklyCaseloadSummary' | 'draftMonthlyFamilySummary' | 'translateSummary' | 'draftDistrictMonthlyNarrative'

export const SUMMARY_OUTPUT_SCHEMAS = {
  draftDailySummary: DraftDailyModelOutput,
  draftWeeklyCaseloadSummary: DraftWeeklyModelOutput,
  draftMonthlyFamilySummary: DraftMonthlyFamilyModelOutput,
  translateSummary: TranslateSummaryModelOutput,
  draftDistrictMonthlyNarrative: DraftDistrictModelOutput,
} as const

export interface SummaryProvider {
  readonly name: string
  draftDailySummary(i: z.output<typeof DraftDailyInput>): Promise<Parsed<typeof DraftDailyModelOutput>>
  draftWeeklyCaseloadSummary(i: z.output<typeof DraftWeeklyInput>): Promise<Parsed<typeof DraftWeeklyModelOutput>>
  draftMonthlyFamilySummary(i: z.output<typeof DraftMonthlyFamilyInput>): Promise<Parsed<typeof DraftMonthlyFamilyModelOutput>>
  translateSummary(i: z.output<typeof TranslateSummaryInput>): Promise<Parsed<typeof TranslateSummaryModelOutput>>
  draftDistrictMonthlyNarrative(i: z.output<typeof DraftDistrictInput>): Promise<Parsed<typeof DraftDistrictModelOutput>>
}

// ---------- fixture (deterministic, built from the input) ----------

const SHOWN = 4
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const trendWord = (values: number[]) => {
  if (values.length < 2) return 'steady'
  const first = values[0]
  const last = values[values.length - 1]
  const ratio = first === 0 ? (last > 0 ? 1 : 0) : (last - first) / Math.abs(first)
  return ratio > 0.05 ? 'up' : ratio < -0.05 ? 'down' : 'steady'
}

function fixtureDaily(i: z.output<typeof DraftDailyInput>) {
  const who = i.studentToken
  if (i.dataPoints.length === 0) {
    return { text: `No confirmed data was logged for ${who} on ${i.date}.`, highlights: [], citations: [...i.events.map((e) => e.id), ...i.notes.map((n) => n.id)] }
  }
  const shown = i.dataPoints.slice(0, SHOWN)
  const lines = shown.map((d) => `${d.objective}: ${d.value}${d.promptLevel ? ` (${d.promptLevel})` : ''}`)
  const more = i.dataPoints.length > shown.length ? ` ${i.dataPoints.length - shown.length} more entries are in the log.` : ''
  const ev = i.events.length ? ` ${i.events.length} event${i.events.length === 1 ? ' was' : 's were'} logged.` : ''
  const text = `On ${i.date}, ${who} had ${i.dataPoints.length} confirmed entr${i.dataPoints.length === 1 ? 'y' : 'ies'}. ${lines.join('; ')}.${ev}${more}`
  return {
    text,
    highlights: shown.slice(0, 3).map((d) => `${d.objective}: ${d.value}${d.promptLevel ? ` with ${d.promptLevel}` : ''}`),
    citations: [...i.dataPoints.map((d) => d.id), ...i.events.map((e) => e.id), ...i.notes.map((n) => n.id)],
  }
}

function fixtureWeekly(i: z.output<typeof DraftWeeklyInput>) {
  const perStudent = i.students.map((s) => {
    const parts = s.objectives.map((o) => ({ o, w: trendWord(o.trend.map((t) => t.value)), vals: o.trend.map((t) => t.value) }))
    const withData = parts.filter((p) => p.vals.length > 0)
    const drops = withData.filter((p) => p.w === 'down')
    const big = drops.some((p) => p.vals[0] !== 0 && (p.vals[0] - p.vals[p.vals.length - 1]) / Math.abs(p.vals[0]) >= 0.2)
    const flag = withData.length === 0 ? ('watch' as const) : big ? ('needs_attention' as const) : drops.length ? ('watch' as const) : ('on_track' as const)
    const text = withData.length
      ? `${withData.slice(0, 3).map((p) => `${p.o.objective} ${p.w} (${num(p.vals[0])} to ${num(p.vals[p.vals.length - 1])})`).join('; ')}.${s.notableEvents.length ? ` ${s.notableEvents.length} notable event${s.notableEvents.length === 1 ? '' : 's'}.` : ''}`
      : 'No confirmed data this week.'
    return { studentRef: s.studentRef, text, flag }
  })
  const count = (f: string) => perStudent.filter((p) => p.flag === f).length
  const overview = `Week of ${i.weekStart}: ${perStudent.length} student${perStudent.length === 1 ? '' : 's'} on the caseload. ${count('on_track')} on track, ${count('watch')} to watch, ${count('needs_attention')} needing attention.`
  const citations = i.students.flatMap((s) => [...s.objectives.flatMap((o) => o.trend.map((t) => t.id)), ...s.notableEvents.map((e) => e.id)])
  return { overview, perStudent, citations }
}

function fixtureMonthly(i: z.output<typeof DraftMonthlyFamilyInput>) {
  const lines = i.objectives
    .filter((o) => o.points.length > 0)
    .slice(0, 3)
    .map((o) => {
      const w = trendWord(o.points.map((p) => p.value))
      return w === 'up' ? `${o.objective} is growing` : w === 'down' ? `${o.objective} had some harder days, and the team is helping` : `${o.objective} is steady`
    })
  const body = lines.length ? `This month, ${lines.join('. ')}.` : 'There was not enough new information to report progress this month.'
  const hi = i.highlights.length ? ` Highlights: ${i.highlights.slice(0, 3).join('; ')}.` : ''
  return {
    text: `Here is how ${i.studentToken} did in ${i.month}. ${body}${hi} Thank you for working with us. Please reach out any time.`,
    citations: i.objectives.flatMap((o) => o.points.map((p) => p.id)),
  }
}

function fixtureDistrict(i: z.output<typeof DraftDistrictInput>) {
  const metrics = [...new Set(i.aggregates.map((a) => a.metric))]
  const lines = metrics.slice(0, 5).map((m) => {
    const rows = i.aggregates.filter((a) => a.metric === m)
    const total = rows.reduce((s, r) => s + r.n, 0)
    const avg = rows.reduce((s, r) => s + r.value * r.n, 0) / Math.max(1, total)
    return `${m}: average ${num(avg)}${rows[0].unit ? ` ${rows[0].unit}` : ''} across ${rows.length} group${rows.length === 1 ? '' : 's'} (${total} students)`
  })
  return { text: `District summary for ${i.month}. ${lines.length ? `${lines.join('. ')}.` : 'No groups were large enough to report.'} Groups with fewer than 10 students are not shown.` }
}

export function createFixtureSummaryProvider(): SummaryProvider {
  return {
    name: 'fixture',
    draftDailySummary: async (i) => fixtureDaily(i),
    draftWeeklyCaseloadSummary: async (i) => fixtureWeekly(i),
    draftMonthlyFamilySummary: async (i) => fixtureMonthly(i),
    // The fixture only knows English: it returns the text unchanged and says so by reporting 'en'.
    translateSummary: async (i) => ({ language: 'en', text: i.text }),
    draftDistrictMonthlyNarrative: async (i) => fixtureDistrict(i),
  }
}

// ---------- Gemini ----------

const INSTRUCTIONS: Record<SummaryName, string> = {
  draftDailySummary:
    'Write a daily summary for the classroom team in plain language, at most 120 words, from the confirmed data points, events and notes only. Add 0 to 5 short highlights. citations lists the ids of the items relied on. Invent nothing.',
  draftWeeklyCaseloadSummary:
    'Write a weekly caseload summary for a case manager: a short overview (at most 150 words) and one entry per student (at most 60 words, studentRef copied exactly) with flag on_track, watch or needs_attention based on the confirmed trend. citations lists ids relied on. Use only the supplied data.',
  draftMonthlyFamilySummary:
    'Write a warm, plain-language monthly progress summary for the family, at most 200 words, no jargon or acronyms, from the supplied objectives progress and highlights only. citations lists data point ids relied on.',
  translateSummary: 'Translate the text into the requested language. Keep tokens in square brackets unchanged. Add no new facts. Return the language tag used.',
  draftDistrictMonthlyNarrative:
    'Write a short monthly narrative (at most 250 words) for a district lead from the aggregate rows only. Never name or identify any student, school or person.',
}

export type GeminiSummaryOptions = {
  apiKey: string
  models?: string
  timeoutMs?: number
  totalTimeoutMs?: number
  fetch?: typeof fetch
  /** Used when the chain fails or the key is refused. */
  fallback?: SummaryProvider
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const FALL_OVER = new Set([429, 503, 404])

export function createGeminiSummaryProvider(options: GeminiSummaryOptions): SummaryProvider & { readonly lastSource: 'gemini' | 'fixture' } {
  if (!options.apiKey) throw new AiNotConfiguredError('GEMINI_API_KEY is not set')
  const models = parseModels(options.models)
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS
  const totalMs = options.totalTimeoutMs ?? GEMINI_TOTAL_TIMEOUT_MS
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const fallback = options.fallback ?? createFixtureSummaryProvider()
  let lastSource: 'gemini' | 'fixture' = 'gemini'

  async function viaGemini(fn: SummaryName, input: unknown): Promise<unknown> {
    const schema = SUMMARY_OUTPUT_SCHEMAS[fn]
    const deadline = Date.now() + totalMs
    let lastIssue: AiOutputError | null = null
    for (const model of models) {
      const budget = deadline - Date.now()
      if (budget <= 0) break
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(timeoutMs, budget)))
      try {
        const res = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${INSTRUCTIONS[fn]}\nReturn only JSON matching the output schema.\nINPUT:\n${JSON.stringify(input)}` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.2, responseSchema: toGeminiSchema(schema) },
          }),
          signal: ctrl.signal,
        })
        if (FALL_OVER.has(res.status) || res.status >= 500) continue
        if (!res.ok) throw new GeminiError(`Gemini ${model} answered HTTP ${res.status}`, res.status)
        const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
        const text = body.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('')
        if (!text) continue
        let json: unknown
        try {
          json = parseJsonLoose(text)
        } catch {
          lastIssue = new AiOutputError(fn, ['response is not JSON'])
          continue
        }
        const out = schema.safeParse(coerceToSchema(json, toGeminiSchema(schema)))
        if (!out.success) {
          lastIssue = new AiOutputError(fn, out.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`))
          continue
        }
        return out.data
      } catch (err) {
        if (err instanceof GeminiError && err.status) throw err
        // network error or timeout: next model
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastIssue ?? new GeminiError('All Gemini models failed or timed out')
  }

  async function call(fn: SummaryName, input: unknown): Promise<never> {
    try {
      const out = await viaGemini(fn, input)
      lastSource = 'gemini'
      return out as never
    } catch (err) {
      console.warn(`[altamira-ai] summary ${fn} fell back to fixture (${err instanceof GeminiError && err.status ? err.status : 'exhausted'})`)
      lastSource = 'fixture'
      return (fallback[fn] as (i: unknown) => Promise<never>)(input)
    }
  }

  return {
    name: 'gemini',
    get lastSource() {
      return lastSource
    },
    draftDailySummary: (i) => call('draftDailySummary', i),
    draftWeeklyCaseloadSummary: (i) => call('draftWeeklyCaseloadSummary', i),
    draftMonthlyFamilySummary: (i) => call('draftMonthlyFamilySummary', i),
    translateSummary: (i) => call('translateSummary', i),
    draftDistrictMonthlyNarrative: (i) => call('draftDistrictMonthlyNarrative', i),
  }
}

/** Gemini when GEMINI_API_KEY is set (fixture fallback on failure), fixture otherwise. */
export function summaryProviderFromEnv(env: GeminiEnv & { ALTAMIRA_AI_PROVIDER?: string }, fetchImpl?: typeof fetch): SummaryProvider {
  const forced = (env.ALTAMIRA_AI_PROVIDER ?? '').trim().toLowerCase()
  if (forced !== 'fixture' && env.GEMINI_API_KEY?.trim()) {
    return createGeminiSummaryProvider({ apiKey: env.GEMINI_API_KEY, models: env.ALTAMIRA_GEMINI_MODELS, fetch: fetchImpl })
  }
  return createFixtureSummaryProvider()
}
