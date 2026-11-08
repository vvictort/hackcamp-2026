import { describe, expect, it } from 'vitest'
import { sha256Hex } from './tokens'

describe('sha256Hex', () => {
  it('hashes to 64 hex characters, deterministically', async () => {
    const a = await sha256Hex('abc')
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('abc')).toBe(a)
  })
})
