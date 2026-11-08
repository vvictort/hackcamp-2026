import { AI_SCHEMAS, type AiFunctionName, type AiProvider } from '../contract/ai'
import { FIXTURE_NAMES } from '../fixtures'

/** Test-only helpers for the AI module. */

/** Wraps a provider and records every request payload it receives. */
export function recordingProvider(inner: AiProvider): { provider: AiProvider; requests: { fn: string; payload: unknown }[] } {
  const requests: { fn: string; payload: unknown }[] = []
  const wrap = (fn: AiFunctionName) => (input: unknown) => {
    requests.push({ fn, payload: structuredClone(input) })
    return (inner[fn] as (i: unknown) => Promise<unknown>)(input)
  }
  const provider = { name: inner.name, ...Object.fromEntries((Object.keys(AI_SCHEMAS) as AiFunctionName[]).map((fn) => [fn, wrap(fn)])) } as unknown as AiProvider
  return { provider, requests }
}

const nameRes = FIXTURE_NAMES.map((n) => ({ n, re: new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, 'iu') }))

/** Fixture names that appear as whole words in the text. */
export const fixtureNamesIn = (text: string): string[] => nameRes.filter(({ re }) => re.test(text)).map(({ n }) => n)
