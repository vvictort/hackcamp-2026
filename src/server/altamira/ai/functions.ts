import type { z } from 'zod'
import { AI_SCHEMAS, type AiFunctionName, type AiProvider, type AnalyseLessonInput, type AnalyseLessonOutput } from '../contract/ai'
import { AltamiraError } from '../contract/errors'
import { collectStrings, deidentify, findIdentifiers, reidentify, type Roster } from './deidentify'
import { AiDeidentificationError, AiOutputError } from './errors'

export type AiInput<K extends AiFunctionName> = z.input<(typeof AI_SCHEMAS)[K]['input']>
export type AiOutput<K extends AiFunctionName> = z.output<(typeof AI_SCHEMAS)[K]['output']>

/** What reached the provider: the de-identified, schema-checked payload. */
export type AiCall = { fn: AiFunctionName; payload: unknown }

export type AiOptions = {
  provider: AiProvider
  /** Everyone who could be named in the input: the school's students, staff, families and the school itself. */
  roster: Roster
  /** Called once per provider call, after de-identification. Used by tests and for metering. */
  onCall?: (call: AiCall) => void
}

export type AiFunctions = { [K in AiFunctionName]: (input: AiInput<K>) => Promise<AiOutput<K>> } & {
  readonly provider: AiProvider
  /** Replaces roster names and identifiers in free text (used before text-to-speech). */
  deidText(text: string): string
  /** Provider calls made so far, per function. */
  readonly calls: Readonly<Record<AiFunctionName, number>>
}

const issuesOf = (error: z.ZodError) => error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)

/** Every studentToken value in an input (top level or nested, e.g. lens profile). */
function studentTokensIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(studentTokensIn)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    k === 'studentToken' && typeof v === 'string' ? [v] : studentTokensIn(v),
  )
}

/**
 * The public AI functions (design doc "AI module"). Each one: validates the
 * input, de-identifies it, refuses the call if any identifier survives, calls
 * the provider, rejects output that fails the contract schema, re-identifies.
 */
export function createAi(options: AiOptions): AiFunctions {
  const { provider, roster, onCall } = options
  const calls = Object.fromEntries(Object.keys(AI_SCHEMAS).map((k) => [k, 0])) as Record<AiFunctionName, number>

  async function run<K extends AiFunctionName>(fn: K, input: AiInput<K>): Promise<AiOutput<K>> {
    const schemas = AI_SCHEMAS[fn]
    const parsed = schemas.input.safeParse(input)
    if (!parsed.success) throw new AltamiraError('bad_request', `Invalid ${fn} input: ${issuesOf(parsed.error).join('; ')}`)

    // Fail closed: a student named in the input must be on the roster, or their name could not be stripped.
    const known = new Set(roster.students.map((st) => st.token))
    if (studentTokensIn(parsed.data).some((t) => !known.has(t))) throw new AiDeidentificationError(fn, ['unrostered_student'])

    const { value, map } = deidentify(parsed.data, roster)
    const payload = schemas.input.parse(value)
    const leaks = collectStrings(payload).flatMap((s) => findIdentifiers(s, roster))
    if (leaks.length > 0) throw new AiDeidentificationError(fn, [...new Set(leaks.map((l) => l.kind))])

    calls[fn] += 1
    onCall?.({ fn, payload })
    const raw = await (provider[fn] as (i: unknown) => Promise<unknown>).call(provider, payload)

    const out = schemas.output.safeParse(raw)
    if (!out.success) throw new AiOutputError(fn, issuesOf(out.error))
    return reidentify(out.data as AiOutput<K>, map)
  }

  return {
    provider,
    calls,
    deidText: (text) => deidentify(text, roster).value,
    proposeObjectives: (i) => run('proposeObjectives', i),
    analyseLesson: (i) => run('analyseLesson', i),
    lensForStudent: (i) => run('lensForStudent', i),
    scorePhotoPage: (i) => run('scorePhotoPage', i),
    parseVoiceNote: (i) => run('parseVoiceNote', i),
    draftProgress: (i) => run('draftProgress', i),
    summariseForFamily: (i) => run('summariseForFamily', i),
  }
}

/** Storage for the one analysis per lesson, e.g. the school room's lesson_analyses table. */
export type LessonAnalysisCache = {
  get(lessonId: string): AnalyseLessonOutput | undefined | Promise<AnalyseLessonOutput | undefined>
  set(lessonId: string, analysis: AnalyseLessonOutput): void | Promise<void>
}

/** PRD 1A-2: analyse each lesson once; every later request reuses the cached analysis. */
export async function analyseLessonOnce(ai: AiFunctions, input: AnalyseLessonInput, cache: LessonAnalysisCache): Promise<AnalyseLessonOutput> {
  const cached = await cache.get(input.lessonId)
  if (cached) return cached
  const analysis = await ai.analyseLesson(input)
  await cache.set(input.lessonId, analysis)
  return analysis
}
