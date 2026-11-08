import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from './testing'
import { createHarness } from './harness'

afterEach(closeAll)

describe('POST /dev/seed is safe to press again', () => {
  it('a second user (or a second press) attaches as case manager instead of failing', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.post('demo-user-1', '/dev/seed')).status).toBe(200)

    const again = await h.post('demo-user-2', '/dev/seed')
    expect(again.status).toBe(200)

    const roles = await h.get('demo-user-2', '/dev/roles')
    expect(roles.status).toBe(200)
    expect((roles.body as { active: string | null }).active).toBe('case_manager')

    expect((await h.post('demo-user-1', '/dev/seed')).status).toBe(200)
  })
})
