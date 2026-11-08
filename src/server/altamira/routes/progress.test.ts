import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { kai, U } from '../e2e/flows'
import { createHarness } from '../e2e/harness'

afterEach(closeAll)

const goalOf = (h: ReturnType<typeof createHarness>) =>
  h.studentSql(kai).get<{ goal_id: string }>(
    "SELECT o.goal_id FROM data_points d JOIN objectives o ON o.id = d.objective_id WHERE d.status IN ('confirmed','auto_confirmed') LIMIT 1",
  )!.goal_id

describe('drafts, family summary and tts routes', () => {
  it('a provider crash becomes clean JSON, not a bare 500', async () => {
    const h = createHarness({
      ai: {
        draftProgress: async () => {
          throw new Error('boom with prompt text')
        },
      },
    })
    const res = await h.post(U.caseManager, `/students/${kai}/drafts`, { goalId: goalOf(h), period: 'Term 1' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).not.toContain('boom')
  })

  it('draft then family summary then approve completes with the fixture provider', async () => {
    const h = createHarness()
    const draft = await h.post(U.caseManager, `/students/${kai}/drafts`, { goalId: goalOf(h), period: 'Term 1' })
    expect(draft.status).toBe(201)
    expect(draft.body.draft.sentences.some((s: { citations: string[] }) => s.citations.length > 0)).toBe(true)
    const summary = await h.post(U.caseManager, `/drafts/${draft.body.draft.id}/family-summary?studentId=${kai}`, { language: 'es' })
    expect(summary.status).toBe(201)
    const done = await h.post(U.caseManager, `/family-summaries/${summary.body.summary.id}/approve?studentId=${kai}`, { expectedVersion: summary.body.summary.version })
    expect(done.status).toBe(200)
  })

  it('tts: 204 without a key, 400 over 2000 characters', async () => {
    const h = createHarness()
    expect((await h.post(U.caseManager, '/tts', { text: 'Hello', language: 'en' })).status).toBe(204)
    const long = await h.post(U.caseManager, '/tts', { text: 'x'.repeat(2001), language: 'en' })
    expect(long.status).toBe(400)
    expect(long.body.error.code).toBe('bad_request')
  })
})
