import { AI_SCHEMAS, type AiFunctionName, type AiProvider, type AiProviderName } from '../../contract/ai'
import type { MediaRef } from '../../contract/common'
import { AiNotConfiguredError, AiOutputError } from '../errors'
import { createFixtureProvider } from './fixture'

/**
 * Gemini through Google AI Studio REST (plain fetch, no SDK). Inputs arrive
 * already de-identified (createAi in ai/functions.ts does that before any
 * provider call and re-identifies the output). Models are tried in order; a
 * 429, 503, 404 or timeout moves to the next model, anything else throws.
 */

export const DEFAULT_GEMINI_MODELS = 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite'
export const GEMINI_TIMEOUT_MS = 25_000
/** Whole-chain budget; each attempt gets min(GEMINI_TIMEOUT_MS, time left). Callers may pass a smaller totalTimeoutMs. */
export const GEMINI_TOTAL_TIMEOUT_MS = 35_000
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const FALL_OVER_STATUS = new Set([429, 503, 404])

export type GeminiEnv = { GEMINI_API_KEY?: string; ALTAMIRA_GEMINI_MODELS?: string }

export type GeminiOptions = {
  apiKey: string
  /** Comma list; defaults to DEFAULT_GEMINI_MODELS. */
  models?: string
  timeoutMs?: number
  totalTimeoutMs?: number
  /** Used when the chain fails or the key is refused; results then carry lastSource 'fixture'. */
  fallback?: AiProvider
  fetch?: typeof fetch
}

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GeminiError'
  }
}

export const parseModels = (raw: string | undefined): string[] => {
  const list = (raw ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  return list.length ? list : DEFAULT_GEMINI_MODELS.split(',')
}

const INSTRUCTIONS: Record<AiFunctionName, string> = {
  proposeObjectives:
    'You help a BC special-education team. Given one IEP goal, propose a measurable objective (metric type, unit, baseline method, target, mastery rule, capture method) or say it is not measurable with a reason.',
  analyseLesson: 'Analyse the lesson: its objectives, competencies, reading and writing load, and the barriers it may pose for students with learning needs.',
  lensForStudent:
    'For one student profile and one analysed lesson, list the gaps (each tied to an IEP goal or accommodation), concrete adaptations tagged to the student goals, and 1 to 3 embedded checks with answer key or rubric.',
  scorePhotoPage: 'Read the sheet code and score each item on the photographed worksheet against the answer key or rubric, with a confidence from 0 to 1.',
  parseVoiceNote: 'Turn the teacher voice note into structured observation events for the listed objectives, with a confidence from 0 to 1.',
  draftProgress:
    'Draft short factual progress sentences for the goal. Every sentence cites the ids of the data points it relies on. Use only the supplied data.',
  summariseForFamily: 'Rewrite the draft as a plain-language family summary in the requested language. Add no new facts.',
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Splits media bytes out of the JSON text so they travel as inline parts. */
function buildParts(fn: AiFunctionName, input: unknown): Part[] {
  const media: Part[] = []
  const text = JSON.stringify(input, (key, value) => {
    if (key === 'bytesBase64' && typeof value === 'string') return undefined
    return value
  })
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Partial<MediaRef> & Record<string, unknown>
    if (typeof o.bytesBase64 === 'string' && typeof o.contentType === 'string') media.push({ inlineData: { mimeType: o.contentType, data: o.bytesBase64 } })
    Object.values(o).forEach(walk)
  }
  walk(input)
  return [{ text: `${INSTRUCTIONS[fn]}\nReturn only JSON matching the output schema.\nINPUT:\n${text}` }, ...media]
}

function extractText(body: unknown): string {
  const parts = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts
  const text = parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new GeminiError('Gemini returned no content')
  return text
}

/** Strips a ```json fence and any text around the outermost JSON value. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.search(/[{[]/)
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
    if (start < 0 || end <= start) throw new Error('not JSON')
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

export function createGeminiProvider(options: GeminiOptions): AiProvider {
  if (!options.apiKey) throw new AiNotConfiguredError('GEMINI_API_KEY is not set')
  const models = parseModels(options.models)
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS
  const totalMs = options.totalTimeoutMs ?? GEMINI_TOTAL_TIMEOUT_MS
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const { fallback } = options
  let lastSource: 'gemini' | 'fixture' = 'gemini'
  const log = (model: string, what: string | number) => console.warn(`[altamira-ai] ${model} ${what}`)

  /** Text, 'next' (try another model), or throws GeminiError for a fatal status (400/401/403 and other 4xx). */
  async function attempt(model: string, fn: AiFunctionName, input: unknown, budgetMs: number): Promise<string | 'next'> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(timeoutMs, budgetMs)))
    try {
      const res = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: buildParts(fn, input) }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
        signal: ctrl.signal,
      })
      if (FALL_OVER_STATUS.has(res.status) || res.status >= 500) {
        log(model, res.status)
        return 'next'
      }
      if (!res.ok) throw new GeminiError(`Gemini ${model} answered HTTP ${res.status}`, res.status)
      return extractText(await res.json())
    } catch (err) {
      if (err instanceof GeminiError && err.status) throw err
      log(model, ctrl.signal.aborted ? 'timeout' : 'error')
      return 'next'
    } finally {
      clearTimeout(timer)
    }
  }

  async function viaGemini<K extends AiFunctionName>(fn: K, input: unknown) {
    const deadline = Date.now() + totalMs
    const tried: string[] = []
    let lastIssue: AiOutputError | null = null
    for (const model of models) {
      const budget = deadline - Date.now()
      if (budget <= 0) {
        log('chain', `budget of ${totalMs} ms used up`)
        break
      }
      tried.push(model)
      const text = await attempt(model, fn, input, budget)
      if (text === 'next') continue
      let json: unknown
      try {
        json = parseJsonLoose(text)
      } catch {
        log(model, 'unparseable')
        lastIssue = new AiOutputError(fn, ['response is not JSON'])
        continue
      }
      const out = AI_SCHEMAS[fn].output.safeParse(json)
      if (!out.success) {
        log(model, 'off-schema')
        lastIssue = new AiOutputError(fn, out.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`))
        continue
      }
      return out.data
    }
    log('chain', `tried ${tried.join(', ') || 'none'}; using fixture`)
    if (lastIssue) throw lastIssue
    throw new GeminiError(`All Gemini models failed or timed out (${tried.join(', ') || models.join(', ')})`)
  }

  async function call<K extends AiFunctionName>(fn: K, input: unknown) {
    try {
      const out = await viaGemini(fn, input)
      lastSource = 'gemini'
      return out
    } catch (err) {
      if (!fallback) throw err
      log('chain', err instanceof GeminiError && err.status ? err.status : 'exhausted')
      lastSource = 'fixture'
      return (fallback[fn] as (i: unknown) => Promise<unknown>)(input) as Promise<ReturnType<typeof viaGemini<K>> extends Promise<infer R> ? R : never>
    }
  }

  // The contract's AiProviderName has no 'gemini' yet; the cast is dropped once it does.
  const name = 'gemini' as AiProviderName
  return {
    name,
    get lastSource() {
      return lastSource
    },
    proposeObjectives: (i) => call('proposeObjectives', i),
    analyseLesson: (i) => call('analyseLesson', i),
    lensForStudent: (i) => call('lensForStudent', i),
    scorePhotoPage: (i) => call('scorePhotoPage', i),
    parseVoiceNote: (i) => call('parseVoiceNote', i),
    draftProgress: (i) => call('draftProgress', i),
    summariseForFamily: (i) => call('summariseForFamily', i),
  } as AiProvider
}

export function geminiFromEnv(env: GeminiEnv, fetchImpl?: typeof fetch, totalTimeoutMs?: number): AiProvider {
  return createGeminiProvider({ apiKey: env.GEMINI_API_KEY ?? '', models: env.ALTAMIRA_GEMINI_MODELS, totalTimeoutMs, fetch: fetchImpl, fallback: createFixtureProvider() })
}
