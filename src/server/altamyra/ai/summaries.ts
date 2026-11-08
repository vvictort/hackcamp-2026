import { reidentify, type Roster } from './deidentify'
import { AiOutputError } from './errors'
import { guardedAi, valuesOfKeys } from './functions'
import { createFixtureSummaryProvider, SUMMARY_SCHEMAS, type SummaryName, type SummaryProvider } from './summaries-provider'
import {
  DRAFT_STAMP,
  type DraftDailyInput,
  type DraftDailyOutput,
  type DraftMonthlyFamilyInput,
  type DraftMonthlyFamilyOutput,
  type DraftWeeklyInput,
  type DraftWeeklyOutput,
} from './summaries-schemas'

export * from './summaries-schemas'
export { createFixtureSummaryProvider, createGeminiSummaryProvider, summaryProviderFromEnv, type SummaryProvider } from './summaries-provider'

/**
 * AI drafting functions for the daily, weekly and monthly family summaries.
 * Same chain as createAi (guardedAi), on confirmed data only, plus a check
 * that every citation is an id from the payload.
 *
 * Every result is { status: 'draft', generatedBy: 'ai' }. APPROVAL IS ENFORCED
 * IN THE ROUTES: an EA or teacher must approve before the case manager or
 * parent can see the text. These functions never release.
 */

export type SummaryAiOptions = {
  /** Defaults to the fixture provider. */
  provider?: SummaryProvider
  roster: Roster
}

export type SummaryAi = {
  draftDailySummary(input: DraftDailyInput): Promise<DraftDailyOutput>
  draftWeeklyCaseloadSummary(input: DraftWeeklyInput): Promise<DraftWeeklyOutput>
  draftMonthlyFamilySummary(input: DraftMonthlyFamilyInput): Promise<DraftMonthlyFamilyOutput>
}

const ID_KEYS = new Set(['id'])

export function createSummaryAi(options: SummaryAiOptions): SummaryAi {
  const { prepare, call } = guardedAi(SUMMARY_SCHEMAS, options.provider ?? createFixtureSummaryProvider(), options.roster)

  function checkCitations(fn: SummaryName, cited: string[], payload: unknown) {
    const allowed = new Set(valuesOfKeys(payload, ID_KEYS))
    const bad = cited.filter((c) => !allowed.has(c))
    if (bad.length > 0) throw new AiOutputError(fn, [`citations: unknown ids ${bad.join(', ')}`])
  }

  return {
    async draftDailySummary(input) {
      const { payload, map } = prepare('draftDailySummary', withConfirmedOnly(input, ['dataPoints']))
      const out = await call('draftDailySummary', payload)
      checkCitations('draftDailySummary', out.citations, payload)
      return { ...reidentify(out, map), ...DRAFT_STAMP }
    },

    async draftWeeklyCaseloadSummary(input) {
      const { data, payload, map } = prepare('draftWeeklyCaseloadSummary', withWeeklyConfirmedOnly(input))
      const out = await call('draftWeeklyCaseloadSummary', payload)
      checkCitations('draftWeeklyCaseloadSummary', out.citations, payload)
      const refs = new Set(data.students.map((s) => s.studentRef))
      const bad = out.perStudent.filter((p) => !refs.has(p.studentRef))
      if (bad.length > 0) throw new AiOutputError('draftWeeklyCaseloadSummary', ['perStudent: unknown studentRef'])
      const restored = reidentify(out, map)
      // studentRef is a roster token the caller matches on; only the text is re-identified.
      return { ...restored, perStudent: restored.perStudent.map((p, k) => ({ ...p, studentRef: out.perStudent[k].studentRef })), ...DRAFT_STAMP }
    },

    async draftMonthlyFamilySummary(input) {
      const { data, payload, map } = prepare('draftMonthlyFamilySummary', withMonthlyConfirmedOnly(input))
      const english = await call('draftMonthlyFamilySummary', payload)
      checkCitations('draftMonthlyFamilySummary', english.citations, payload)
      let text = english.text
      let outLanguage = 'en'
      if (!/^en(-|$)/i.test(data.language)) {
        const tr = await call('translateSummary', { text: english.text, language: data.language, studentToken: payload.studentToken })
        text = tr.text
        outLanguage = tr.language
      }
      const restored = reidentify({ text, englishText: english.text, citations: english.citations }, map)
      return { ...restored, language: outLanguage, ...DRAFT_STAMP }
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
