import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_NAMES, closeAll } from './testing'
import { approvedMathSheets, sofia } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)
const DEMO_USER = 'demo-user-1'

describe('M1 lens usage and coded sheets through /api/v1', () => {
  it('lists the seeded approved adaptations on lens-usage, one event per usage row, tagged to current goals', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.post(DEMO_USER, '/dev/seed')).status).toBe(200)
    const usage = await h.get(DEMO_USER, `/students/${sofia}/lens-usage`)
    expect(usage.status).toBe(200)
    const rows = h.studentSql(sofia).all<{ suggestion_id: string }>('SELECT suggestion_id FROM usage_events')
    const events = usage.body.events as { suggestionId: string; label: string; goalIds: string[] }[]
    expect(events.map((e) => e.suggestionId).sort()).toEqual(rows.map((r) => r.suggestion_id).sort())
    const goals = new Set(((await h.get(DEMO_USER, `/students/${sofia}`)).body.goals as { id: string }[]).map((g) => g.id))
    for (const e of events) {
      expect(e.label).toBe('adaptation')
      expect(e.goalIds.every((g) => goals.has(g))).toBe(true)
    }
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
  })
})
