import { afterEach, describe, expect, it } from 'vitest'
import { CBIEP_SAMPLE_TEXT } from '../fixtures'
import { closeAll } from '../services/testing'
import { amara, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('permission matrix enforced on the API (PRD NFR Security)', () => {
  it('refuses a teacher write to the IEP with 403 and points to proposals', async () => {
    const h = createHarness()
    const res = await h.post(U.teacher, `/students/${kai}/iep/import`, { sourceKind: 'text', text: CBIEP_SAMPLE_TEXT })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden')
    expect(res.body.error.message).toContain('iep.propose')
    expect(h.studentSql(kai).get<{ n: number }>('SELECT COUNT(*) AS n FROM iep_versions')?.n).toBe(1)
    expect(h.aiCalls.proposeObjectives).toBe(0)
  })

  it('an EA cannot see a student who is not assigned to them', async () => {
    const h = createHarness()
    expect((await h.get(U.ea, `/students/${kai}`)).status).toBe(200)
    for (const path of [`/students/${amara}`, `/students/${amara}/timeline`, `/students/${amara}/objectives`]) {
      expect((await h.get(U.ea, path)).status).toBe(403)
    }
  })

  it('a parent cannot see another child', async () => {
    const h = createHarness()
    expect((await h.get(U.parentKai, `/family/${kai}/progress`)).status).toBe(200)
    expect((await h.get(U.parentKai, `/family/${amara}/progress`)).status).toBe(403)
    expect((await h.get(U.parentKai, `/students/${sofia}/timeline`)).status).toBe(403)
  })

  it('needs sign-in, validates bodies, and hides dev seed unless enabled', async () => {
    const h = createHarness()
    expect((await h.get(null, '/me')).status).toBe(401)
    const me = await h.get(U.caseManager, '/me')
    expect(me.status).toBe(200)
    const bad = await h.post(U.teacher, `/students/${kai}/events`, { kind: 'prompt_level' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('bad_request')
    expect((await h.post(U.schoolAdmin, '/dev/seed')).status).toBe(404)
    const unknown = await h.get(U.caseManager, '/no-such-route')
    expect(unknown).toEqual({ status: 404, body: { error: { code: 'not_found', message: 'Unknown Altamira route' } } })
  })

  it('POST /dev/seed loads the fictional fixtures when ALTAMIRA_DEV_SEED is on', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.get(U.caseManager, '/me')).body.caseload ?? []).toHaveLength(0)
    const seeded = await h.post(U.schoolAdmin, '/dev/seed')
    expect(seeded.status).toBe(200)
    expect(seeded.body.studentIds.sort()).toEqual([kai, amara, sofia].sort())
    expect((await h.get(U.caseManager, `/students/${kai}`)).status).toBe(200)
  })
})
