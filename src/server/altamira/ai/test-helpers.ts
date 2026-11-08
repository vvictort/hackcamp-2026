import type { AiProvider } from '../contract/ai'
import { FIXTURE_NAMES } from '../fixtures'

/** Test-only helpers for the AI module. */

/** Wraps a provider and records every request payload it receives. */
export function recordingProvider(inner: AiProvider): { provider: AiProvider; requests: { fn: string; payload: unknown }[] } {
  const requests: { fn: string; payload: unknown }[] = []
  const wrap =
    <K extends Exclude<keyof AiProvider, 'name'>>(fn: K) =>
    (input: Parameters<AiProvider[K]>[0]) => {
      requests.push({ fn, payload: structuredClone(input) })
      return (inner[fn] as (i: unknown) => ReturnType<AiProvider[K]>)(input)
    }
  const provider: AiProvider = {
    name: inner.name,
    proposeObjectives: wrap('proposeObjectives'),
    analyseLesson: wrap('analyseLesson'),
    lensForStudent: wrap('lensForStudent'),
    scorePhotoPage: wrap('scorePhotoPage'),
    parseVoiceNote: wrap('parseVoiceNote'),
    draftProgress: wrap('draftProgress'),
    summariseForFamily: wrap('summariseForFamily'),
  }
  return { provider, requests }
}

const nameRes = FIXTURE_NAMES.map((n) => ({ n, re: new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, 'iu') }))

/** Fixture names that appear as whole words in the text. */
export const fixtureNamesIn = (text: string): string[] => nameRes.filter(({ re }) => re.test(text)).map(({ n }) => n)
