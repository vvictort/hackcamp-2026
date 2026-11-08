import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from './testing'
import { WHAT_WORKS_MIN_N } from '../services/thresholds'
import { amara, kai, sofia } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)
const U = 'demo-user-1'

async function rows(h: ReturnType<typeof createHarness>, id: string) {
  return (await h.get(U, `/students/${id}/what-works`)).body.rows as { adaptationType: string; n: number; meanOutcome: number | null; hidden: boolean }[]
}

describe('what works on the demo seed', () => {
  it('lists non-hidden rows with evidence for every seeded student', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.post(U, '/dev/seed')).status).toBe(200)
    for (const id of [kai, amara, sofia]) {
      const shown = (await rows(h, id)).filter((r) => !r.hidden)
      expect(shown.length, id).toBeGreaterThanOrEqual(1)
      for (const r of shown) {
        expect(r.n).toBeGreaterThanOrEqual(WHAT_WORKS_MIN_N)
        expect(r.meanOutcome).not.toBeNull()
      }
    }
  })

  it('has one student with two types that differ clearly', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    await h.post(U, '/dev/seed')
    const spreads: number[] = []
    for (const id of [kai, amara, sofia]) {
      const m = (await rows(h, id)).filter((r) => !r.hidden && r.meanOutcome !== null).map((r) => r.meanOutcome as number)
      if (m.length >= 2) spreads.push(Math.max(...m) - Math.min(...m))
    }
    expect(Math.max(0, ...spreads)).toBeGreaterThanOrEqual(0.2)
  })
})

describe('lens usage on the demo seed', () => {
  it('counts each seeded adaptation type once per usage event', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    await h.post(U, '/dev/seed')
    const used = (await h.get(U, `/students/${kai}/lens-usage`)).body.used as { adaptationType: string; n: number }[]
    const rows = h.studentSql(kai).all<{ adaptationType: string; n: number }>(
      `SELECT s.adaptation_type AS adaptationType, COUNT(*) AS n FROM usage_events u JOIN suggestions s ON s.id = u.suggestion_id
       WHERE s.kind = 'adaptation' GROUP BY s.adaptation_type`,
    )
    expect(used.length).toBeGreaterThan(0)
    expect([...used].sort((a, b) => a.adaptationType.localeCompare(b.adaptationType))).toEqual(rows.sort((a, b) => a.adaptationType.localeCompare(b.adaptationType)))
  })
})
