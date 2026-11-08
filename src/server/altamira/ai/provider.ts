import { AI_PROVIDER_NAMES, type AiProvider } from '../contract/ai'
import { geminiFromEnv, type GeminiEnv } from './providers/gemini'
import { createFixtureProvider } from './providers/fixture'
import { createVertexProvider } from './providers/vertex'

export type AiEnv = GeminiEnv & { ALTAMIRA_AI_PROVIDER?: string }

/**
 * Picks the provider: ALTAMIRA_AI_PROVIDER "vertex" or "fixture" forces that
 * one; otherwise GEMINI_API_KEY present gives Gemini, and no key gives the fixture.
 */
export function getProvider(env: AiEnv = {}): AiProvider {
  const raw = (env.ALTAMIRA_AI_PROVIDER ?? '').trim().toLowerCase()
  if (raw && raw !== 'gemini' && !(AI_PROVIDER_NAMES as readonly string[]).includes(raw)) {
    throw new Error(`Unknown ALTAMIRA_AI_PROVIDER "${raw}"; expected one of ${[...AI_PROVIDER_NAMES, 'gemini'].join(', ')}`)
  }
  if (raw === 'vertex') return createVertexProvider()
  if (raw === 'fixture') return createFixtureProvider()
  if (env.GEMINI_API_KEY?.trim()) return geminiFromEnv(env)
  return createFixtureProvider()
}
