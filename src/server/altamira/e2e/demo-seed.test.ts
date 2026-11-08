import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { coverageOf } from '../../../lib/altamira/coverage'
import { amara, kai, sofia } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)
const U = 'demo-user-1'

async function seeded() {
  const h = createHarness({ seed: false, devSeed: true })
  expect((await h.post(U, '/dev/seed')).status).toBe(200)
  return h
}

describe('relative-dated demo seed', () => {
  it('404s the dev routes without the flag, even when signed in', async () => {
    const h = createHarness({ seed: false })
    for (const [method, path] of [['post', '/dev/seed'], ['get', '/dev/roles'], ['post', '/dev/role']] as const) {
      expect((await (h as any)[method](U, path, {})).status).toBe(404)
    }
  })

  it('gives every goal a timeline and a mix of fresh, stale and data-needed coverage', async () => {
    const h = await seeded()
    const kinds: string[] = []
    for (const id of [kai, amara, sofia]) {
      const profile = await h.get(U, `/students/${id}`)
      expect(profile.status).toBe(200)
      for (const g of profile.body.goals) {
        const tl = await h.get(U, `/students/${id}/goals/${g.id}/aimline`)
        expect(tl.body.points.length).toBeGreaterThanOrEqual(8)
        const spanDays = (Date.parse(tl.body.points.at(-1).date) - Date.parse(tl.body.points[0].date)) / 86_400_000
        expect(spanDays).toBeGreaterThanOrEqual(21)
        const st = await h.get(U, `/students/${id}/goals/${g.id}/status`)
        kinds.push(coverageOf(st.body))
      }
    }
    expect(new Set(kinds)).toEqual(new Set(['fresh', 'stale', 'data_needed']))
  })

  it('fires a decision, ranks strategies with evidence counts and lists coming-up items', async () => {
    const h = await seeded()
    const digest = await h.get(U, '/me/digest')
    expect(digest.body.items.some((i: { decision: { rule: string } }) => i.decision.rule === 'below_aimline')).toBe(true)

    const ww = await h.get(U, `/students/${kai}/what-works`)
    const shown = ww.body.rows.filter((r: { hidden: boolean }) => !r.hidden)
    expect(shown.length).toBeGreaterThanOrEqual(2)
    expect(shown[0].n).toBeGreaterThanOrEqual(shown[1].n)

    const up = await h.get(U, '/me/coming-up')
    expect(up.status).toBe(200)
    const kindsUp = new Set(up.body.items.map((i: { kind: string }) => i.kind))
    expect(kindsUp).toEqual(new Set(['iep_meeting', 'review_queue', 'data_due']))
  })

  it('links the student role to Kai so a session can start', async () => {
    const h = await seeded()
    expect((await h.post(U, '/dev/role', { role: 'student' })).status).toBe(200)
    expect((await h.post(U, `/students/${kai}/sessions`, {})).status).toBe(201)
    expect((await h.post(U, `/students/${amara}/sessions`, {})).status).toBe(403)
  })
})
