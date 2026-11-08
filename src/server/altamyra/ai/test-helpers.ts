import { FIXTURE_NAMES } from '../fixtures'

/** Test-only helpers for the AI module. */

/** Wraps a provider and records every request payload it receives. */
export function recordingProvider<P extends object>(inner: P): { provider: P; requests: { fn: string; payload: unknown }[] } {
  const requests: { fn: string; payload: unknown }[] = []
  const provider = Object.fromEntries(
    Object.entries(inner).map(([fn, impl]) => [
      fn,
      (input: unknown) => {
        requests.push({ fn, payload: structuredClone(input) })
        return (impl as (i: unknown) => Promise<unknown>)(input)
      },
    ]),
  ) as P
  return { provider, requests }
}

const nameRes = FIXTURE_NAMES.map((n) => ({ n, re: new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, 'iu') }))

/** Fixture names that appear as whole words in the text. */
export const fixtureNamesIn = (text: string): string[] => nameRes.filter(({ re }) => re.test(text)).map(({ n }) => n)
