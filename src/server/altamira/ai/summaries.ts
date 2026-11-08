import type { z } from 'zod'
import { AltamiraError } from '../contract/errors'
import { collectStrings, deidentify, findIdentifiers, reidentify, type Roster } from './deidentify'
import { AiDeidentificationError, AiOutputError } from './errors'
import { createFixtureSummaryProvider, SUMMARY_OUTPUT_SCHEMAS, type SummaryName, type SummaryProvider } from './summaries-provider'
import {
  DRAFT_STAMP,
  DraftDailyInput,
  DraftDistrictInput,
  DraftMonthlyFamilyInput,
  DraftWeeklyInput,
  MIN_DISTRICT_GROUP,
  TranslateSummaryInput,
  type DraftDailyOutput,
  type DraftDistrictOutput,
  type DraftMonthlyFamilyOutput,
  type DraftWeeklyOutput,
  type TranslateSummaryOutput,
} from './summaries-schemas'

export * from './summaries-schemas'
export { createFixtureSummaryProvider, createGeminiSummaryProvider, summaryProviderFromEnv, type SummaryProvider } from './summaries-provider'

/**
 * AI drafting functions for the daily, weekly, monthly family and district
 * monthly summaries. Same chain as createAi: validate, keep confirmed data
 * only, de-identify, refuse if an identifier survives, call the provider,
 * validate the output (including its citations), re-identify.
 *
 * Every result is { status: 'draft', generatedBy: 'ai' }. APPROVAL IS ENFORCED
 * IN THE ROUTES: an EA or teacher must approve before the case manager,
 * parent or district lead can see the text. These functions never release.
 */

export type SummaryCall = { fn: SummaryName; payload: unknown }
export type SummaryAiOptions = {
  /** Defaults to the fixture provider. */
  provider?: SummaryProvider
  roster: Roster
  onCall?: (call: SummaryCall) => void
}

export type SummaryAi = {
  draftDailySummary(input: DraftDailyInput): Promise<DraftDailyOutput>
  draftWeeklyCaseloadSummary(input: DraftWeeklyInput): Promise<DraftWeeklyOutput>
  draftMonthlyFamilySummary(input: DraftMonthlyFamilyInput): Promise<DraftMonthlyFamilyOutput>
  translateSummary(input: TranslateSummaryInput): Promise<TranslateSummaryOutput>
  draftDistrictMonthlyNarrative(input: DraftDistrictInput): Promise<DraftDistrictOutput>
  readonly calls: Readonly<Record<SummaryName, number>>
}

const issuesOf = (error: z.ZodError) => error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)

/** Every value of the given keys, at any depth. */
function valuesOfKeys(value: unknown, keys: Set<string>): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => valuesOfKeys(v, keys))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (keys.has(k) && typeof v === 'string' ? [v] : valuesOfKeys(v, keys)))
}

/** Every `id` in the payload: what an output may cite. */
const idsIn = (value: unknown): Set<string> => new Set(valuesOfKeys(value, new Set(['id'])))

export function createSummaryAi(options: SummaryAiOptions): SummaryAi {
  const { roster, onCall } = options
  const provider = options.provider ?? createFixtureSummaryProvider()
  const known = new Set(roster.students.map((s) => s.token))
  const calls: Record<SummaryName, number> = {
    draftDailySummary: 0,
    draftWeeklyCaseloadSummary: 0,
    draftMonthlyFamilySummary: 0,
    translateSummary: 0,
    draftDistrictMonthlyNarrative: 0,
  }

  /** Validates, de-identifies and leak-checks; returns the payload and a restore function. */
  function prepare(fn: SummaryName, schema: z.ZodType, input: unknown) {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new AltamiraError('bad_request', `Invalid ${fn} input: ${issuesOf(parsed.error).join('; ')}`)
    const refs = valuesOfKeys(parsed.data, new Set(['studentToken', 'studentRef']))
    if (refs.some((t) => !known.has(t))) throw new AiDeidentificationError(fn, ['unrostered_student'])
    const { value, map } = deidentify(parsed.data, roster)
    const payload = schema.parse(value)
    const leaks = collectStrings(payload).flatMap((s) => findIdentifiers(s, roster))
    if (leaks.length > 0) throw new AiDeidentificationError(fn, [...new Set(leaks.map((l) => l.kind))])
    return { data: parsed.data, payload, map }
  }

  async function call<K extends SummaryName>(fn: K, payload: unknown): Promise<z.output<(typeof SUMMARY_OUTPUT_SCHEMAS)[K]>> {
    calls[fn] += 1
    onCall?.({ fn, payload })
    const raw = await (provider[fn] as (i: unknown) => Promise<unknown>).call(provider, payload)
    const out = SUMMARY_OUTPUT_SCHEMAS[fn].safeParse(raw)
    if (!out.success) throw new AiOutputError(fn, issuesOf(out.error))
    return out.data as never
  }

  function checkCitations(fn: SummaryName, cited: string[], payload: unknown) {
    const allowed = idsIn(payload)
    const bad = cited.filter((c) => !allowed.has(c))
    if (bad.length > 0) throw new AiOutputError(fn, [`citations: unknown ids ${bad.join(', ')}`])
  }

  return {
    calls,

    async draftDailySummary(input) {
      const { payload, map } = prepare('draftDailySummary', DraftDailyInput, withConfirmedOnly(input, ['dataPoints']))
      const out = await call('draftDailySummary', payload)
      checkCitations('draftDailySummary', out.citations, payload)
      return { ...reidentify(out, map), ...DRAFT_STAMP }
    },

    async draftWeeklyCaseloadSummary(input) {
      const trimmed = withWeeklyConfirmedOnly(input)
      const { data, payload, map } = prepare('draftWeeklyCaseloadSummary', DraftWeeklyInput, trimmed)
      const out = await call('draftWeeklyCaseloadSummary', payload)
      checkCitations('draftWeeklyCaseloadSummary', out.citations, payload)
      const refs = new Set((data as z.output<typeof DraftWeeklyInput>).students.map((s) => s.studentRef))
      const bad = out.perStudent.filter((p) => !refs.has(p.studentRef))
      if (bad.length > 0) throw new AiOutputError('draftWeeklyCaseloadSummary', ['perStudent: unknown studentRef'])
      const restored = reidentify(out, map)
      // studentRef is a roster token the caller matches on; only the text is re-identified.
      return { ...restored, perStudent: restored.perStudent.map((p, k) => ({ ...p, studentRef: out.perStudent[k].studentRef })), ...DRAFT_STAMP }
    },

    async draftMonthlyFamilySummary(input) {
      const { data, payload, map } = prepare('draftMonthlyFamilySummary', DraftMonthlyFamilyInput, withMonthlyConfirmedOnly(input))
      const { language } = data as z.output<typeof DraftMonthlyFamilyInput>
      const english = await call('draftMonthlyFamilySummary', payload)
      checkCitations('draftMonthlyFamilySummary', english.citations, payload)
      let text = english.text
      let outLanguage = 'en'
      if (!/^en(-|$)/i.test(language)) {
        const tr = await call('translateSummary', { text: english.text, language, studentToken: (payload as { studentToken: string }).studentToken })
        text = tr.text
        outLanguage = tr.language
      }
      const restored = reidentify({ text, englishText: english.text, citations: english.citations }, map)
      return { ...restored, language: outLanguage, ...DRAFT_STAMP }
    },

    async translateSummary(input) {
      const { payload, map } = prepare('translateSummary', TranslateSummaryInput, input)
      const out = await call('translateSummary', payload)
      return { ...reidentify(out, map), ...DRAFT_STAMP }
    },

    async draftDistrictMonthlyNarrative(input) {
      // .strict() on the schema rejects studentId, name and any other per-student key.
      const parsed = DraftDistrictInput.safeParse(input)
      if (!parsed.success) throw new AltamiraError('bad_request', `Invalid draftDistrictMonthlyNarrative input: ${issuesOf(parsed.error).join('; ')}`)
      // Defence in depth: rows under the minimum group size are dropped, never sent.
      const aggregates = parsed.data.aggregates.filter((r) => r.n >= MIN_DISTRICT_GROUP)
      if (aggregates.length === 0) throw new AltamiraError('bad_request', `No aggregate row has ${MIN_DISTRICT_GROUP} or more students`)
      const { payload, map } = prepare('draftDistrictMonthlyNarrative', DraftDistrictInput, { ...parsed.data, aggregates })
      const out = await call('draftDistrictMonthlyNarrative', payload)
      return { ...reidentify(out, map), ...DRAFT_STAMP }
    },
  }
}

// ---------- confirmed-only filters (applied before validation, so unconfirmed data never travels) ----------

type Loose = Record<string, unknown>
const onlyConfirmed = (rows: unknown): unknown => (Array.isArray(rows) ? rows.filter((r) => (r as Loose)?.confirmed === true) : rows)

function withConfirmedOnly(input: unknown, keys: string[]): unknown {
  if (!input || typeof input !== 'object') return input
  const o = { ...(input as Loose) }
  for (const k of keys) o[k] = onlyConfirmed(o[k])
  return o
}

function withWeeklyConfirmedOnly(input: unknown): unknown {
  const o = input as { students?: unknown }
  if (!Array.isArray(o?.students)) return input
  return {
    ...(o as Loose),
    students: o.students.map((s: Loose) => ({
      ...s,
      objectives: Array.isArray(s.objectives) ? s.objectives.map((ob: Loose) => ({ ...ob, trend: onlyConfirmed(ob.trend) })) : s.objectives,
    })),
  }
}

function withMonthlyConfirmedOnly(input: unknown): unknown {
  const o = input as { objectives?: unknown }
  if (!Array.isArray(o?.objectives)) return input
  return { ...(o as Loose), objectives: o.objectives.map((ob: Loose) => ({ ...ob, points: onlyConfirmed(ob.points) })) }
}
