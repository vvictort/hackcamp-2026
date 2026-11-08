import type { AiProvider } from '../contract/ai'
import { createGeminiProvider } from './providers/gemini'
import { createFixtureProvider } from './providers/fixture'
import { maritimeAgent, withMaritime, type MaritimeEnv } from './providers/maritime'

export type AiEnv = MaritimeEnv & { GEMINI_API_KEY?: string }

export const hasGeminiKey = (env: AiEnv): boolean => !!env.GEMINI_API_KEY?.trim()

export function getProvider(env: AiEnv = {}, teacher = 'anonymous'): AiProvider {
  const base = hasGeminiKey(env) ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY!, fallback: createFixtureProvider() }) : createFixtureProvider()
  const agent = maritimeAgent(env)
  return agent ? withMaritime(base, { ...agent, teacher }) : base
}
