import { describe, expect, it } from 'vitest'
import { HttpError } from '../middleware/errors'
import { AiOutputError } from './errors'
import { guardAi } from './guard'

describe('guardAi', () => {
  it('passes values and Altamira errors through', async () => {
    expect(await guardAi(async () => 5)).toBe(5)
    await expect(guardAi(async () => { throw new HttpError('forbidden', 'no') })).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('maps unexpected errors to a clean bad_request without leaking details', async () => {
    for (const err of [new Error('secret prompt text'), new AiOutputError('draftProgress', ['x'])]) {
      const e = await guardAi(async () => { throw err }).catch((x) => x)
      expect(e).toBeInstanceOf(HttpError)
      expect(e.message).not.toContain('secret')
      expect(e.message).not.toContain('schema')
    }
  })
})
