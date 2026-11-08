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

const meWith = (roles: string[], parentOf: string[] = []) => ({ ...me, memberships: roles.map((role) => ({ role })), parentOf }) as unknown as Parameters<typeof import('./role').roleFromMe>[0]

describe('roles', () => {
  it('has the six roles and no student', async () => {
    const { ALTAMIRA_ROLES } = await import('./role')
    expect([...ALTAMIRA_ROLES]).toEqual(['ea', 'teacher', 'case_manager', 'parent', 'district_lead', 'school_admin'])
  })
  it('maps memberships to roles in order, school_admin kept apart, parent last', async () => {
    const { roleFromMe } = await import('./role')
    expect(roleFromMe(meWith(['school_admin']))).toBe('school_admin')
    expect(roleFromMe(meWith(['case_manager', 'ea']))).toBe('ea')
    expect(roleFromMe(meWith(['district_lead', 'school_admin']))).toBe('district_lead')
    expect(roleFromMe(meWith([], ['s1']))).toBe('parent')
    expect(roleFromMe(meWith([]))).toBeNull()
  })
})

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

describe('schoolIdOf', () => {
  it('reads schoolId from /me', async () => {
    vi.resetModules()
    const { schoolIdOf } = await import('./role')
    expect(schoolIdOf({ ...me, schoolId: 'sch1' } as never)).toBe('sch1')
    expect(schoolIdOf(me as never)).toBeNull()
    expect(schoolIdOf(null)).toBeNull()
  })
})
