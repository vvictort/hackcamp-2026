import { describe, expect, it } from 'vitest'
import { AltamiraError } from '../contract/errors'
import { aiFailureResponse } from './cbiep'

describe('aiFailureResponse', () => {
  it('turns a provider failure into a clean 502 without details', async () => {
    const res = aiFailureResponse(new Error('fetch failed: https://x?key=SECRET'))
    expect(res?.status).toBe(502)
    const body = (await res!.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ai_unavailable')
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })
  it('leaves contract errors to the normal handler', () => {
    expect(aiFailureResponse(new AltamiraError('bad_request', 'x'))).toBeNull()
  })
})
