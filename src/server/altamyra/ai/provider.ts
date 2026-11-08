import { AI_PROVIDER_NAMES, type AiProvider } from '../contract/ai'
import { geminiFromEnv, type GeminiEnv } from './providers/gemini'
import { createFixtureProvider } from './providers/fixture'
import { maritimeAgent, withMaritime, type MaritimeEnv } from './providers/maritime'
import { createVertexProvider } from './providers/vertex'

export type AiEnv = GeminiEnv & MaritimeEnv & { ALTAMYRA_AI_PROVIDER?: string }

/**
 * Picks the provider: ALTAMYRA_AI_PROVIDER "vertex" or "fixture" forces that
 * one; otherwise GEMINI_API_KEY present gives Gemini, and no key gives the fixture.
 * Unless forced to the fixture, MARITIME_AGENT_URL and MARITIME_AGENT_TOKEN send
 * Lesson Lens to the Maritime agent, with that provider as the fallback;
 * `teacher` is the opaque hash the agent keeps its per-teacher memory under.
 */
export function getProvider(env: AiEnv = {}, teacher = 'anonymous'): AiProvider {
  const raw = (env.ALTAMYRA_AI_PROVIDER ?? '').trim().toLowerCase()
  if (raw && raw !== 'gemini' && !(AI_PROVIDER_NAMES as readonly string[]).includes(raw)) {
    throw new Error(`Unknown ALTAMYRA_AI_PROVIDER "${raw}"; expected one of ${[...AI_PROVIDER_NAMES, 'gemini'].join(', ')}`)
  }
  if (raw === 'fixture') return createFixtureProvider()
  const base = raw === 'vertex' ? createVertexProvider() : env.GEMINI_API_KEY?.trim() ? geminiFromEnv(env) : createFixtureProvider()
  const agent = maritimeAgent(env)
  return agent ? withMaritime(base, { ...agent, teacher }) : base
}
