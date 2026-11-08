import { describe, expect, it } from 'vitest'
import { createFixtureProvider } from './fixture'

describe('fixture summariseForFamily', () => {
  const draft = { sentences: [{ text: 'Reads 20 words.' }] }
  it('returns clean English with language en when the language is unsupported', async () => {
    const out = await createFixtureProvider().summariseForFamily({ studentToken: 'S-X', language: 'es', draft })
    expect(out.language).toBe('en')
    expect(out.text).not.toMatch(/Fixture/i)
    expect(out.text).toContain('Reads 20 words.')
  })
  it('keeps the requested language when a template exists', async () => {
    const out = await createFixtureProvider().summariseForFamily({ studentToken: 'S-X', language: 'fr', draft })
    expect(out.language).toBe('fr')
  })
})
