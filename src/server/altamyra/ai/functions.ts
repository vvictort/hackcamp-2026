import type { z } from 'zod'
import { AI_SCHEMAS, type AiFunctionName, type AiProvider } from '../contract/ai'
import { AltamyraError } from '../contract/errors'
import { issuesOf } from '../contract/issues'
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

type SchemaPairs = Record<string, { input: z.ZodType; output: z.ZodType }>

const STUDENT_KEYS = new Set(['studentToken', 'studentRef'])

/** Every value of the given keys, at any depth. */
export function valuesOfKeys(value: unknown, keys: Set<string>): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => valuesOfKeys(v, keys))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (keys.has(k) && typeof v === 'string' ? [v] : valuesOfKeys(v, keys)))
}

/**
 * The guarded chain every AI call goes through. prepare validates the input,
 * refuses a student missing from the roster, de-identifies and refuses the
 * call if any identifier survives; call counts it, calls the provider and
 * rejects output that fails the schema. Callers re-identify with the map.
 */
export function guardedAi<S extends SchemaPairs>(schemas: S, provider: object, roster: Roster, onCall?: (call: { fn: keyof S & string; payload: unknown }) => void) {
  type Name = keyof S & string
  const calls = Object.fromEntries(Object.keys(schemas).map((k) => [k, 0])) as Record<Name, number>
  const known = new Set(roster.students.map((st) => st.token))

  return {
    calls,

    prepare<K extends Name>(fn: K, input: unknown) {
      const schema = schemas[fn].input
      const parsed = schema.safeParse(input)
      if (!parsed.success) throw new AltamyraError('bad_request', `Invalid ${fn} input: ${issuesOf(parsed.error).join('; ')}`)
      // Fail closed: a student named in the input must be on the roster, or their name could not be stripped.
      if (valuesOfKeys(parsed.data, STUDENT_KEYS).some((t) => !known.has(t))) throw new AiDeidentificationError(fn, ['unrostered_student'])
      const { value, map } = deidentify(parsed.data, roster)
      const payload = schema.parse(value) as z.output<S[K]['input']>
      const leaks = collectStrings(payload).flatMap((s) => findIdentifiers(s, roster))
      if (leaks.length > 0) throw new AiDeidentificationError(fn, [...new Set(leaks.map((l) => l.kind))])
      return { data: parsed.data as z.output<S[K]['input']>, payload, map }
    },

    async call<K extends Name>(fn: K, payload: unknown): Promise<z.output<S[K]['output']>> {
      calls[fn] += 1
      onCall?.({ fn, payload })
      const raw = await ((provider as Record<string, (i: unknown) => Promise<unknown>>)[fn]).call(provider, payload)
      const out = schemas[fn].output.safeParse(raw)
      if (!out.success) throw new AiOutputError(fn, issuesOf(out.error))
      return out.data as z.output<S[K]['output']>
    },
  }
}

/** The public AI functions (design doc "AI module"), each run through guardedAi and re-identified. */
export function createAi(options: AiOptions): AiFunctions {
  const { provider, roster, onCall } = options
  const guard = guardedAi(AI_SCHEMAS, provider, roster, onCall)

  async function run<K extends AiFunctionName>(fn: K, input: AiInput<K>): Promise<AiOutput<K>> {
    const { payload, map } = guard.prepare(fn, input)
    return reidentify(await guard.call(fn, payload), map)
  }

  return {
    ...(Object.fromEntries((Object.keys(AI_SCHEMAS) as AiFunctionName[]).map((fn) => [fn, (i: never) => run(fn, i)])) as Omit<AiFunctions, 'provider' | 'calls' | 'deidText'>),
    provider,
    calls: guard.calls,
    deidText: (text) => deidentify(text, roster).value,
  }
}
