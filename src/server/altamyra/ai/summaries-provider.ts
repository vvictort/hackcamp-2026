import type { z } from 'zod'
import { hasGeminiKey, type AiEnv } from './provider'
import { generateJson, type GeminiConfig } from './providers/gemini'
import {
  DraftDailyInput,
  DraftDailyModelOutput,
  DraftMonthlyFamilyInput,
  DraftMonthlyFamilyModelOutput,
  DraftWeeklyInput,
  DraftWeeklyModelOutput,
  TranslateSummaryInput,
  TranslateSummaryModelOutput,
} from './summaries-schemas'

/**
 * Providers for the summary drafts. Inputs are already de-identified and
 * schema-parsed (createSummaryAi does that). Outputs carry no status: the
 * caller stamps 'draft' / 'ai'.
 */

export const SUMMARY_SCHEMAS = {
  draftDailySummary: { input: DraftDailyInput, output: DraftDailyModelOutput },
  draftWeeklyCaseloadSummary: { input: DraftWeeklyInput, output: DraftWeeklyModelOutput },
  draftMonthlyFamilySummary: { input: DraftMonthlyFamilyInput, output: DraftMonthlyFamilyModelOutput },
  translateSummary: { input: TranslateSummaryInput, output: TranslateSummaryModelOutput },
} as const

type Schemas = typeof SUMMARY_SCHEMAS
export type SummaryName = keyof Schemas

export type SummaryProvider = {
  [K in SummaryName]: (i: z.output<Schemas[K]['input']>) => Promise<z.output<Schemas[K]['output']>>
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

/** A goal's wording is long ("By June 2027, the student will ..."): keep its first few words so the draft stays inside the word limits. */
const label = (objective: string) => {
  const core = objective.replace(/^by \w+ \d{4},?\s*/i, '').replace(/^(after [^,]*, )?the student will /i, '')
  const words = core.split(/\s+/).filter(Boolean)
  return words.length > 7 ? `${words.slice(0, 7).join(' ')}...` : core
}

function fixtureDaily(i: z.output<typeof DraftDailyInput>) {
  const who = i.studentToken
  if (i.dataPoints.length === 0) {
    return { text: `No confirmed data was logged for ${who} on ${i.date}.`, highlights: [], citations: [...i.events.map((e) => e.id), ...i.notes.map((n) => n.id)] }
  }
  const shown = i.dataPoints.slice(0, SHOWN)
  const lines = shown.map((d) => `${label(d.objective)}: ${d.value}${d.promptLevel ? ` (${d.promptLevel})` : ''}`)
  const more = i.dataPoints.length > shown.length ? ` ${i.dataPoints.length - shown.length} more entries are in the log.` : ''
  const ev = i.events.length ? ` ${i.events.length} event${i.events.length === 1 ? ' was' : 's were'} logged.` : ''
  const text = `On ${i.date}, ${who} had ${i.dataPoints.length} confirmed entr${i.dataPoints.length === 1 ? 'y' : 'ies'}. ${lines.join('; ')}.${ev}${more}`
  return {
    text,
    highlights: shown.slice(0, 3).map((d) => `${label(d.objective)}: ${d.value}${d.promptLevel ? ` with ${d.promptLevel}` : ''}`),
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
      ? `${withData.slice(0, 3).map((p) => `${label(p.o.objective)} ${p.w} (${num(p.vals[0])} to ${num(p.vals[p.vals.length - 1])})`).join('; ')}.${s.notableEvents.length ? ` ${s.notableEvents.length} notable event${s.notableEvents.length === 1 ? '' : 's'}.` : ''}`
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
      const name = label(o.objective)
      return w === 'up' ? `${name} is growing` : w === 'down' ? `${name} had some harder days, and the team is helping` : `${name} is steady`
    })
  const body = lines.length ? `This month, ${lines.join('. ')}.` : 'There was not enough new information to report progress this month.'
  const hi = i.highlights.length ? ` Highlights: ${i.highlights.slice(0, 3).join('; ')}.` : ''
  return {
    text: `Here is how ${i.studentToken} did in ${i.month}. ${body}${hi} Thank you for working with us. Please reach out any time.`,
    citations: i.objectives.flatMap((o) => o.points.map((p) => p.id)),
  }
}

export function createFixtureSummaryProvider(): SummaryProvider {
  return {
    draftDailySummary: async (i) => fixtureDaily(i),
    draftWeeklyCaseloadSummary: async (i) => fixtureWeekly(i),
    draftMonthlyFamilySummary: async (i) => fixtureMonthly(i),
    // The fixture only knows English: it returns the text unchanged and says so by reporting 'en'.
    translateSummary: async (i) => ({ language: 'en', text: i.text }),
  }
}

// ---------- Gemini ----------

// Names are replaced by tokens before the call; the model must write the token itself, which the app turns back into the name.
const NAME_RULE = ' Refer to the student only by the exact studentToken value from the input (for example S-K7Q4), never by a placeholder such as [studentToken].'

const INSTRUCTIONS: Record<SummaryName, string> = {
  draftDailySummary:
    'Write a daily summary for the classroom team in plain language, at most 120 words, from the confirmed data points, events and notes only. Add 0 to 5 short highlights. citations lists the ids of the items relied on. Invent nothing.' + NAME_RULE,
  draftWeeklyCaseloadSummary:
    'Write a weekly caseload summary for a case manager: a short overview (at most 150 words) and one entry per student (at most 60 words, studentRef copied exactly) with flag on_track, watch or needs_attention based on the confirmed trend. citations lists ids relied on. Use only the supplied data.' + NAME_RULE,
  draftMonthlyFamilySummary:
    'Write a warm, plain-language monthly progress summary for the family, at most 200 words, no jargon or acronyms, from the supplied objectives progress and highlights only. citations lists data point ids relied on.' + NAME_RULE,
  translateSummary: 'Translate the text into the requested language. Keep tokens in square brackets unchanged. Add no new facts. Return the language tag used.',
}

export function createGeminiSummaryProvider(options: GeminiConfig): SummaryProvider {
  const call = (fn: SummaryName, input: unknown): Promise<never> => generateJson(options, fn, INSTRUCTIONS[fn], input, SUMMARY_SCHEMAS[fn].output) as Promise<never>

  return {
    draftDailySummary: (i) => call('draftDailySummary', i),
    draftWeeklyCaseloadSummary: (i) => call('draftWeeklyCaseloadSummary', i),
    draftMonthlyFamilySummary: (i) => call('draftMonthlyFamilySummary', i),
    translateSummary: (i) => call('translateSummary', i),
  }
}

export function summaryProviderFromEnv(env: AiEnv): SummaryProvider {
  return hasGeminiKey(env) ? createGeminiSummaryProvider({ apiKey: env.GEMINI_API_KEY! }) : createFixtureSummaryProvider()
}
