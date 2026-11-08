import type { AiProvider } from '../../contract/ai'
import { AiNotConfiguredError } from '../errors'

/**
 * Gemini on Vertex AI (Canadian region), design doc "Providers". A stub until
 * the GCP service account and the @ai-sdk/google-vertex dependency are
 * approved; every call throws so nothing silently falls back.
 */
export function createVertexProvider(): AiProvider {
  const fail = async (): Promise<never> => {
    throw new AiNotConfiguredError()
  }
  return {
    name: 'vertex',
    proposeObjectives: fail,
    analyseLesson: fail,
    lensForStudent: fail,
    scorePhotoPage: fail,
    parseVoiceNote: fail,
  }
}
