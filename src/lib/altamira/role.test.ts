import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('deepspace', () => ({ useAuthProfileReady: () => ({ isSignedIn: false }), getAuthToken: async () => null }))

const me = { userId: 'u', displayName: null, memberships: [{ role: 'teacher' }], caseload: [], students: [], classes: [], todaySchedule: [], parentOf: [] }

async function load(devSeed: boolean) {
  vi.resetModules()
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    const body = String(url).includes('/dev/roles') ? { active: 'teacher' } : { ...me, devSeed }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const mod = await import('./role')
  await mod.refreshAltamiraMe()
  return { calls, mod }
}

afterEach(() => vi.unstubAllGlobals())

describe('role store dev flag', () => {
  it('does not probe /dev/roles when server says devSeed false', async () => {
    const { calls } = await load(false)
    expect(calls.some((c) => c.includes('/dev/roles'))).toBe(false)
  })
  it('probes /dev/roles when devSeed true', async () => {
    const { calls } = await load(true)
    expect(calls.some((c) => c.includes('/dev/roles'))).toBe(true)
  })
})
