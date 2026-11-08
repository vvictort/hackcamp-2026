/**
 * The signed-in user's Altamira role and the dev-only demo controls. A small
 * module store, so Navigation and pages share one copy without a provider.
 * `devEnabled` is true only when the backend answers /dev/roles, which it does
 * only when ALTAMIRA_DEV_SEED === 'true'.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { ApiError, apiGet, apiPost, type MeResponse } from './api'

export const ALTAMIRA_ROLES = ['ea', 'teacher', 'case_manager', 'parent', 'district_lead', 'school_admin'] as const
export type AltamiraRole = (typeof ALTAMIRA_ROLES)[number]

type State = {
  status: 'idle' | 'loading' | 'ready'
  role: AltamiraRole | null
  devEnabled: boolean
  me: MeResponse | null
}

let state: State = { status: 'idle', role: null, devEnabled: false, me: null }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

/** Role implied by memberships when no dev role is recorded. */
export function roleFromMe(me: MeResponse): AltamiraRole | null {
  const roles = me.memberships.map((m) => m.role)
  for (const r of ['ea', 'teacher', 'case_manager', 'district_lead', 'school_admin'] as const) if (roles.includes(r)) return r
  return me.parentOf.length ? 'parent' : null
}

export async function refreshAltamiraMe(): Promise<void> {
  set({ status: 'loading' })
  let me: MeResponse | null = null
  try {
    me = await apiGet<MeResponse>('/me')
  } catch {
    me = null
  }
  let devEnabled = false
  let active: AltamiraRole | null = null
  if (me && (me as MeResponse & { devSeed?: boolean }).devSeed === true) {
    try {
      const d = await apiGet<{ active: AltamiraRole | null }>('/dev/roles')
      devEnabled = true
      active = d.active
    } catch (e) {
      if (!(e instanceof ApiError)) devEnabled = false
    }
  }
  set({ status: 'ready', me, devEnabled, role: me ? (active ?? roleFromMe(me)) : null })
}

export function useAltamiraMe() {
  const { isSignedIn } = useAuthProfileReady({ requireUser: true })
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
  useEffect(() => {
    if (isSignedIn && state.status === 'idle') void refreshAltamiraMe()
    if (!isSignedIn && state.status === 'ready' && state.me) set({ status: 'idle', me: null, role: null, devEnabled: false })
  }, [isSignedIn])

  const seed = useCallback(async () => {
    await apiPost('/dev/seed')
    await refreshAltamiraMe()
  }, [])
  const switchRole = useCallback(async (role: AltamiraRole) => {
    await apiPost('/dev/role', { role })
    await refreshAltamiraMe()
  }, [])

  return { role: snap.role, devEnabled: snap.devEnabled, me: snap.me, loading: snap.status !== 'ready', seed, switchRole, refresh: refreshAltamiraMe }
}
