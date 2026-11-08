import { afterEach, describe, expect, it } from 'vitest'
import type { Env } from '../../../../worker'
import { productionDeps } from '../routes/defaults'
import { closeAll } from './testing'
import { createHarness } from './harness'

afterEach(closeAll)

const U = 'demo-user-1'

describe('ALTAMYRA_DEV_SEED flag', () => {
  it.each([undefined, false])('flag off (%s): dev routes 404 and /me reports devSeed false', async (devSeed) => {
    const h = createHarness({ seed: false, devSeed })
    expect((await h.post(U, '/dev/seed')).status).toBe(404)
    expect((await h.post(U, '/dev/seed', { reset: true })).status).toBe(404)
    expect((await h.post(U, '/dev/role', { role: 'teacher' })).status).toBe(404)
    expect((await h.get(U, '/dev/roles')).status).toBe(404)
    expect((await h.get(U, '/me')).body.devSeed).toBe(false)
  })

  it('flag on: seed and role work and /me reports devSeed true', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.post(U, '/dev/seed')).status).toBe(200)
    expect((await h.post(U, '/dev/role', { role: 'teacher' })).status).toBe(200)
    expect((await h.get(U, '/me')).body.devSeed).toBe(true)
  })

  it('production deps read the env string: only "true" enables', () => {
    const on = (v?: string) => productionDeps.devSeedEnabled({ ALTAMYRA_DEV_SEED: v } as unknown as Env)
    expect(on('true')).toBe(true)
    for (const v of [undefined, 'false', '', '1', 'TRUE']) expect(on(v)).toBe(false)
  })
})
