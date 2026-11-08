import { isAltamyraError } from '../contract/errors'
import { HttpError } from '../middleware/errors'
import { AiDeidentificationError, AiNotConfiguredError, AiOutputError } from './errors'
import type { AiFunctions } from './functions'

/** Which provider answered the last call: 'gemini', 'fixture' (key missing or chain failed), or the provider name. */
export function aiSource(ai: AiFunctions): string {
  return (ai.provider as { lastSource?: string }).lastSource ?? ai.provider.name
}

/**
 * Runs an AI call and maps any unexpected failure to a clean JSON error
 * (HttpError), never a bare "Internal Server Error". Messages carry no prompt text.
 */
export async function guardAi<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (isAltamyraError(err)) throw err
    if (err instanceof AiDeidentificationError) {
      throw new HttpError('bad_request', 'The text still contains a name or identifier, so it was not sent to the AI. Remove it and try again.')
    }
    if (err instanceof AiOutputError || err instanceof AiNotConfiguredError) {
      throw new HttpError('bad_request', 'The AI helper could not produce a result right now. Try again in a moment.')
    }
    console.warn('[altamyra-ai] unexpected failure', err instanceof Error ? err.name : typeof err)
    throw new HttpError('bad_request', 'The AI helper is unavailable right now. Try again in a moment.')
  }
}
