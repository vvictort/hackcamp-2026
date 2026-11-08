import { AI_PROVIDER_NAMES, type AiProvider, type AiProviderName } from '../contract/ai'
import { createFixtureProvider } from './providers/fixture'
import { createVertexProvider } from './providers/vertex'

export type AiEnv = { ALTAMIRA_AI_PROVIDER?: string }

/** Selects the provider from env ALTAMIRA_AI_PROVIDER; "fixture" when unset or empty. */
export function getProvider(env: AiEnv = {}): AiProvider {
  const raw = (env.ALTAMIRA_AI_PROVIDER ?? '').trim().toLowerCase() || 'fixture'
  if (!(AI_PROVIDER_NAMES as readonly string[]).includes(raw)) {
    throw new Error(`Unknown ALTAMIRA_AI_PROVIDER "${raw}"; expected one of ${AI_PROVIDER_NAMES.join(', ')}`)
  }
  const name = raw as AiProviderName
  return name === 'vertex' ? createVertexProvider() : createFixtureProvider()
}
