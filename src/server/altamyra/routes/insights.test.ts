import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from '../e2e/harness'
import { DISTRICT, STUDENT_IDS, USER_IDS } from '../fixtures'
import { closeAll } from '../e2e/testing'

afterEach(closeAll)
const DEMO = 'demo-user-1'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

async function demoLead() {
  const h = createHarness({ seed: false, devSeed: true })
  expect((await h.post(DEMO, '/dev/seed')).status).toBe(200)
  expect((await h.post(DEMO, '/dev/role', { role: 'district_lead' })).status).toBe(200)
  const me = await h.get(DEMO, '/me')
  const districtId = me.body.memberships.find((m: { role: string }) => m.role === 'district_lead').districtId as string
  return { h, districtId }
}

describe('district lead monthly summary (R6, S4)', () => {
  it('dev-seeded district lead: own district 200 with suppression, narrative, and no identifiers', async () => {
    const { h, districtId } = await demoLead()
    const res = await h.get(DEMO, `/districts/${districtId}/insights?groupBy=schoolId,goalArea`)
    expect(res.status).toBe(200)
    const groups = res.body.groups as { suppressed: boolean; students: number | null; count: number | null }[]
    for (const g of groups) {
      if (g.suppressed) expect(g).toMatchObject({ students: null, count: null })
      else expect(g.students).toBeGreaterThanOrEqual(10)
    }
    // The dev seed pushes no district counters, so there is nothing to show; the narrative still says so calmly.
    expect(groups.every((g) => g.suppressed)).toBe(true)
    expect(res.body.monthlyNarrative.text).toMatch(/No learning data|nothing to report/)
    const json = JSON.stringify(res.body)
    for (const id of Object.values(STUDENT_IDS)) expect(json).not.toContain(id)
    expect(json).not.toMatch(/studentKey|demopeer|hash-/)
    expect(JSON.stringify(res.body.monthlyNarrative)).not.toMatch(UUID)
  })

  it('another district: 403', async () => {
    const { h } = await demoLead()
    expect((await h.get(DEMO, '/districts/00000000-0000-4000-8000-000000000000/insights')).status).toBe(403)
  })

  it('per-student routes: 403 for the district lead', async () => {
    const h = createHarness()
    const id = STUDENT_IDS.kai
    expect((await h.get(USER_IDS.districtLead, `/districts/${DISTRICT.id}/insights`)).status).toBe(200)
    for (const path of [`/students/${id}`, `/students/${id}/summaries`, `/students/${id}/days`]) {
      expect((await h.get(USER_IDS.districtLead, path)).status).toBe(403)
    }
  })
})
