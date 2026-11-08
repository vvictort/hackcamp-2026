import type { z } from 'zod'
import { AI_SCHEMAS, type AiFunctionName, type AiProvider } from '../../contract/ai'
import type { MediaRef } from '../../contract/common'
import { issuesOf } from '../../contract/issues'
import { AiOutputError } from '../errors'
import { coerceToSchema, toGeminiSchema } from './gemini-schema'

/**
 * Gemini through Google AI Studio REST (plain fetch, no SDK). Inputs arrive
 * already de-identified (createAi in ai/functions.ts does that before any
 * provider call and re-identifies the output). Models are tried in order; a
 * 429, 503, 404 or timeout moves to the next model, anything else throws.
 */

export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']
export const GEMINI_TIMEOUT_MS = 25_000
/** Whole-chain budget; each attempt gets min(GEMINI_TIMEOUT_MS, time left). Callers may pass a smaller totalTimeoutMs. */
export const GEMINI_TOTAL_TIMEOUT_MS = 35_000
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const FALL_OVER_STATUS = new Set([429, 503, 404])

export type GeminiConfig = {
  apiKey: string
  models?: string[]
  timeoutMs?: number
  totalTimeoutMs?: number
  fetch?: typeof fetch
}

export type GeminiOptions = GeminiConfig & {
  fallback?: AiProvider
}

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GeminiError'
  }
}

export type GeminiPart = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }
type RequestPart = { text: string } | { inlineData: { mimeType: string; data: string } }

export type GeminiRequest<T> = {
  apiKey: string
  models: string[]
  timeoutMs: number
  totalTimeoutMs: number
  fetch?: typeof fetch
  parts: RequestPart[]
  generationConfig: Record<string, unknown>
  optionalConfig?: (model: string) => Record<string, unknown>
  read: (parts: GeminiPart[], model: string) => T
}

const log = (model: string, what: string | number) => console.warn(`[altamyra-ai] ${model} ${what}`)

/** Per-attempt diagnostic: model, status, elapsed ms, reason. Never the key, prompt or student text. */
const diag = (model: string, status: number | string, t0: number, reason: string) =>
  console.warn(`[altamyra-ai] attempt model=${model} status=${status} ms=${Date.now() - t0} reason=${reason}`)

export async function generate<T>(req: GeminiRequest<T>): Promise<T> {
  const doFetch = req.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  async function attempt(model: string, budgetMs: number): Promise<GeminiPart[] | 'next'> {
    const t0 = Date.now()
    let plain = !req.optionalConfig
    for (;;) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(req.timeoutMs, budgetMs - (Date.now() - t0))))
      try {
        const generationConfig = { ...req.generationConfig, ...(plain ? {} : req.optionalConfig?.(model)) }
        const res = await doFetch(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: req.parts }], generationConfig }),
          signal: ctrl.signal,
        })
        if (FALL_OVER_STATUS.has(res.status) || res.status >= 500) {
          diag(model, res.status, t0, `http_${res.status}`)
          return 'next'
        }
        if (res.status === 400 && !plain) {
          diag(model, 400, t0, 'http_400 retry_plain')
          plain = true
          continue
        }
        if (!res.ok) {
          diag(model, res.status, t0, `http_${res.status}`)
          throw new GeminiError(`Gemini ${model} answered HTTP ${res.status}`, res.status)
        }
        const body = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] } }[] }
        diag(model, res.status, t0, 'ok')
        return body?.candidates?.[0]?.content?.parts ?? []
      } catch (err) {
        if (err instanceof GeminiError && err.status) throw err
        diag(model, ctrl.signal.aborted ? 'timeout' : 'error', t0, ctrl.signal.aborted ? 'timeout' : 'network')
        return 'next'
      } finally {
        clearTimeout(timer)
      }
    }
  }

  const deadline = Date.now() + req.totalTimeoutMs
  const tried: string[] = []
  let lastIssue: unknown = null
  for (const model of req.models) {
    const budget = deadline - Date.now()
    if (budget <= 0) {
      log('chain', `budget of ${req.totalTimeoutMs} ms used up`)
      break
    }
    tried.push(model)
    const parts = await attempt(model, budget)
    if (parts === 'next') continue
    try {
      return req.read(parts, model)
    } catch (err) {
      lastIssue = err
    }
  }
  log('chain', `tried ${tried.join(', ') || 'none'}`)
  throw lastIssue ?? new GeminiError(`All Gemini models failed or timed out (${tried.join(', ') || req.models.join(', ')})`)
}

/** Strips a ```json fence and any text around the outermost JSON value. */
function parseJsonLoose(text: string): unknown {
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

const thinkingFor = (model: string) => (/^gemini-2\.5/.test(model) ? { thinkingBudget: 512 } : { thinkingLevel: 'low' })

/** Splits media bytes out of the JSON text so they travel as inline parts. */
function buildParts(instruction: string, input: unknown): RequestPart[] {
  const media: RequestPart[] = []
  const text = JSON.stringify(input, (key, value) => (key === 'bytesBase64' && typeof value === 'string' ? undefined : value))
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Partial<MediaRef> & Record<string, unknown>
    if (typeof o.bytesBase64 === 'string' && typeof o.contentType === 'string') media.push({ inlineData: { mimeType: o.contentType, data: o.bytesBase64 } })
    Object.values(o).forEach(walk)
  }
  walk(input)
  return [{ text: `${instruction}\nReturn only JSON matching the output schema.\nINPUT:\n${text}` }, ...media]
}

export function generateJson<S extends z.ZodType>(config: GeminiConfig, fn: string, instruction: string, input: unknown, schema: S, thinking = false): Promise<z.output<S>> {
  return generate({
    apiKey: config.apiKey,
    models: config.models ?? GEMINI_MODELS,
    timeoutMs: config.timeoutMs ?? GEMINI_TIMEOUT_MS,
    totalTimeoutMs: config.totalTimeoutMs ?? GEMINI_TOTAL_TIMEOUT_MS,
    fetch: config.fetch,
    parts: buildParts(instruction, input),
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    optionalConfig: (model) => ({ responseSchema: toGeminiSchema(schema), ...(thinking ? { thinkingConfig: thinkingFor(model) } : {}) }),
    read: (answer, model) => {
      const text = answer.filter((p) => !p.thought).map((p) => p.text ?? '').join('')
      if (!text) throw new GeminiError('Gemini returned no content')
      let json: unknown
      try {
        json = parseJsonLoose(text)
      } catch {
        log(model, 'reason=parse')
        throw new AiOutputError(fn, ['response is not JSON'])
      }
      const out = schema.safeParse(coerceToSchema(json, toGeminiSchema(schema)))
      if (!out.success) {
        log(model, `reason=schema ${[...new Set(out.error.issues.slice(0, 3).map((i) => i.path.join('.') || '(root)'))].join(',')}`)
        throw new AiOutputError(fn, issuesOf(out.error))
      }
      return out.data
    },
  })
}

const INSTRUCTIONS: Record<AiFunctionName, string> = {
  proposeObjectives:
    'You help a BC special-education team. Given one IEP goal, propose a measurable objective (metric type, unit, baseline method, target, mastery rule, capture method) or say it is not measurable with a reason.',
  analyseLesson: 'Analyse the lesson: its objectives, competencies, reading and writing load, and the barriers it may pose for students with learning needs.',
  lensForStudent:
    'For one student profile and one analysed lesson, list the gaps (each tied to an IEP goal or accommodation), concrete adaptations tagged to the student goals, and 1 to 3 embedded checks with answer key or rubric.',
  scorePhotoPage: 'Read the sheet code and score each item on the photographed worksheet against the answer key or rubric, with a confidence from 0 to 1.',
  parseVoiceNote: 'Turn the teacher voice note into structured observation events for the listed objectives, with a confidence from 0 to 1.',
}

export function createGeminiProvider(options: GeminiOptions): AiProvider {
  const { fallback } = options

  async function call(fn: AiFunctionName, input: unknown): Promise<unknown> {
    try {
      return await generateJson(options, fn, INSTRUCTIONS[fn], input, AI_SCHEMAS[fn].output, true)
    } catch (err) {
      if (!fallback) throw err
      log('chain', `${err instanceof GeminiError && err.status ? err.status : 'exhausted'}; using fixture`)
      return (fallback[fn] as (i: unknown) => Promise<unknown>)(input)
    }
  }

  return Object.fromEntries((Object.keys(AI_SCHEMAS) as AiFunctionName[]).map((fn) => [fn, (i: unknown) => call(fn, i)])) as unknown as AiProvider
}
