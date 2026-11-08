import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
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

describe('lens approval registers an adaptation row', () => {
  it('stores the approved adaptation as a suggestions row with its type', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    await h.post(U, '/dev/seed')
    // Only the teacher approves tailored plans; the demo user starts as the case manager.
    expect((await h.post(U, '/dev/role', { role: 'teacher' })).status).toBe(200)
    const goals = (await h.get(U, `/students/${kai}`)).body.goals as { id: string; status: string }[]
    const goal = goals.find((g) => g.status === 'active')!
    const res = await h.post(U, '/lens/approvals', {
      studentId: kai,
      subject: 'math',
      lessonText: 'Add within 10',
      items: [{ goalId: goal.id, label: 'adapt', adaptationType: 'alternative_demonstration', title: 'Show it', text: 'Let the student show it orally.', why: 'Goal' }],
    })
    expect(res.status).toBe(201)
    const row = h.studentSql(kai).get<{ adaptation_type: string; kind: string }>('SELECT kind, adaptation_type FROM suggestions WHERE id = ?', res.body.suggestions[0].id)
    expect(row).toMatchObject({ kind: 'adaptation', adaptation_type: 'alternative_demonstration' })
    // A modification the IEP does not authorize is still blocked.
    const bad = await h.post(U, '/lens/approvals', {
      studentId: kai, subject: 'underwater basket weaving', lessonText: 'x',
      items: [{ goalId: goal.id, label: 'modify', adaptationType: 'modified_assessment', title: 'Mod', text: 'Shorter test.', why: '' }],
    })
    expect(bad.body.blocked ?? []).toContain(goal.id)
  })
})
