import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_NAMES } from '../fixtures'
import { closeAll } from '../services/testing'
import { approveAdaptation, approvedMathSheets, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('M1 lesson approvals through /api/v1 (Lens analysis itself lives in src/actions)', () => {
  it('approval stores an approved adaptation tagged to the goal and writes the usage event', async () => {
    const h = createHarness()
    const res = await approveAdaptation(h, sofia)
    expect(res.status).toBe(201)
    expect(res.body.suggestions).toHaveLength(1)
    const usage = h.studentSql(sofia).all<{ suggestion_id: string }>('SELECT suggestion_id FROM usage_events')
    expect(usage.map((u) => u.suggestion_id)).toEqual([res.body.suggestions[0].id])
  })

  it('blocks a modification the IEP does not authorize and allows Sofia’s authorized math modification', async () => {
    const h = createHarness()
    const blocked = await approveAdaptation(h, kai, { label: 'modify', adaptationType: 'modified_assessment' })
    expect(blocked.status).toBe(201)
    expect(blocked.body.blocked).toHaveLength(1)
    expect(h.studentSql(kai).get<{ n: number }>('SELECT COUNT(*) AS n FROM usage_events')?.n).toBe(0)

    const ok = await approveAdaptation(h, sofia, { label: 'modify', adaptationType: 'modified_assessment' })
    expect(ok.status).toBe(201)
    expect(ok.body.blocked).toEqual([])
    expect(ok.body.suggestions).toHaveLength(1)
  })

  it('prints coded sheets with checks; codes and pages carry no names, answer key separate', async () => {
    const h = createHarness({ devSeed: true })
    const { sheets } = await approvedMathSheets(h, sofia)
    expect(sheets.pages.length).toBeGreaterThan(0)
    for (const page of sheets.pages) {
      expect(page.sheetCode).toMatch(/^AL-[A-Z0-9]+$/)
      expect(page.checkItems.length).toBeGreaterThan(0)
      expect(page).not.toHaveProperty('answerKey')
    }
    const printed = JSON.stringify(sheets.pages)
    for (const name of FIXTURE_NAMES) expect(printed).not.toContain(name)
    expect((await h.post(U.ea, '/lens/approvals', { studentId: kai, subject: 'math', items: [] })).status).toBeGreaterThanOrEqual(400)
  })
})
