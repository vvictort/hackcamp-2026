import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { kai, U } from '../e2e/flows'
import { createHarness } from '../e2e/harness'

afterEach(closeAll)

describe('tts route', () => {
  it('204 without a key, 400 over 2000 characters', async () => {
    const h = createHarness()
    expect((await h.post(U.caseManager, '/tts', { text: 'Hello', language: 'en' })).status).toBe(204)
    const long = await h.post(U.caseManager, '/tts', { text: 'x'.repeat(2001), language: 'en' })
    expect(long.status).toBe(400)
    expect(long.body.error.code).toBe('bad_request')
  })

  it('a parent can have their own child\'s approved summary read aloud, but not another child\'s', async () => {
    const h = createHarness()
    expect((await h.post(U.parentKai, '/tts', { text: 'Hello', language: 'ja', studentId: kai })).status).toBe(204)
    expect((await h.post(U.parentSofia, '/tts', { text: 'Hello', language: 'en', studentId: kai })).status).toBe(403)
  })
})

describe('draft routes are gone', () => {
  it('no draft or draft-based summary route exists', async () => {
    const h = createHarness()
    expect((await h.post(U.caseManager, `/students/${kai}/drafts`, { goalId: 'x', period: 'Term 1' })).status).toBe(404)
    expect((await h.post(U.caseManager, `/drafts/x/mark-used?studentId=${kai}`, {})).status).toBe(404)
  })
})
