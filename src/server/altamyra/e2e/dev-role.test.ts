import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from './testing'
import { amara, kai } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

const DEMO = 'demo-user-1'

describe('dev role switcher', () => {
  it('404s seed and role routes without the flag', async () => {
    const h = createHarness({ seed: false })
    expect((await h.post(DEMO, '/dev/seed')).status).toBe(404)
    expect((await h.post(DEMO, '/dev/role', { role: 'teacher' })).status).toBe(404)
    expect((await h.get(DEMO, '/dev/roles')).status).toBe(404)
  })

  it('seeds as case manager, then switches role and access', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.post(DEMO, '/dev/seed')).status).toBe(200)
    expect((await h.get(DEMO, '/dev/roles')).body.active).toBe('case_manager')
    let me = await h.get(DEMO, '/me')
    expect(me.body.memberships.map((m: { role: string }) => m.role)).toEqual(['case_manager', 'case_manager', 'case_manager'])
    expect((await h.get(DEMO, `/students/${amara}`)).status).toBe(200)

    expect((await h.post(DEMO, '/dev/role', { role: 'ea' })).body.active).toBe('ea')
    expect((await h.get(DEMO, `/students/${amara}`)).status).toBe(403)
    expect((await h.get(DEMO, `/students/${kai}`)).status).toBe(200)

    expect((await h.post(DEMO, '/dev/role', { role: 'teacher' })).status).toBe(200)
    me = await h.get(DEMO, '/me')
    expect(me.body.memberships.every((m: { role: string }) => m.role === 'teacher')).toBe(true)

    await h.post(DEMO, '/dev/role', { role: 'parent' })
    me = await h.get(DEMO, '/me')
    expect(me.body.parentOf).toEqual([kai])
    expect((await h.get(DEMO, `/family/${kai}/summaries`)).status).toBe(200)
    expect((await h.get(DEMO, `/family/${amara}/summaries`)).status).toBe(403)

    await h.post(DEMO, '/dev/role', { role: 'district_lead' })
    expect((await h.get(DEMO, '/me')).body.memberships[0].role).toBe('district_lead')
    await h.post(DEMO, '/dev/role', { role: 'school_admin' })
    expect((await h.get(DEMO, '/me')).body.memberships[0].role).toBe('school_admin')
    expect((await h.post(DEMO, '/dev/role', { role: 'nope' })).status).toBe(400)
  })
})
