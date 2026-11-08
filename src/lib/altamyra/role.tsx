/**
 * The signed-in user's Altamyra role and the dev-only demo controls. A small
 * module store, so Navigation and pages share one copy without a provider.
 * `devEnabled` is true only when the backend answers /dev/roles, which it does
 * only when ALTAMYRA_DEV_SEED === 'true'.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { ApiError, apiGet, apiPost, type MeResponse } from './api'

export const ALTAMYRA_ROLES = ['ea', 'teacher', 'case_manager', 'parent', 'district_lead', 'school_admin'] as const
export type AltamyraRole = (typeof ALTAMYRA_ROLES)[number]

type State = {
  status: 'idle' | 'loading' | 'ready'
  role: AltamyraRole | null
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
export function roleFromMe(me: MeResponse): AltamyraRole | null {
  const roles = me.memberships.map((m) => m.role)
  for (const r of ['ea', 'teacher', 'case_manager', 'district_lead', 'school_admin'] as const) if (roles.includes(r)) return r
  return me.parentOf.length ? 'parent' : null
}

/** The school the signed-in user belongs to, as /me reports it. */
export function schoolIdOf(me: MeResponse | null): string | null {
  const id = (me as (MeResponse & { schoolId?: string | null }) | null)?.schoolId
  return typeof id === 'string' && id ? id : null
}

export type StudentSummary = MeResponse['students'][number]

/** Students the signed-in user can see: caseload first, then the rest, no duplicates. */
export function visibleStudents(me: MeResponse | null): StudentSummary[] {
  const seen = new Set<string>()
  return me ? [...me.caseload, ...me.students].filter((s) => !seen.has(s.id) && !!seen.add(s.id)) : []
}

export async function refreshAltamyraMe(): Promise<void> {
  set({ status: 'loading' })
  let me: MeResponse | null = null
  try {
    me = await apiGet<MeResponse>('/me')
  } catch {
    me = null
  }
  let devEnabled = false
  let active: AltamyraRole | null = null
  if (me && (me as MeResponse & { devSeed?: boolean }).devSeed === true) {
    try {
      const d = await apiGet<{ active: AltamyraRole | null }>('/dev/roles')
      devEnabled = true
      active = d.active
    } catch (e) {
      if (!(e instanceof ApiError)) devEnabled = false
    }
  }
  set({ status: 'ready', me, devEnabled, role: me ? (active ?? roleFromMe(me)) : null })
}

export function useAltamyraMe() {
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
    if (isSignedIn && state.status === 'idle') void refreshAltamyraMe()
    if (!isSignedIn && state.status === 'ready' && state.me) set({ status: 'idle', me: null, role: null, devEnabled: false })
  }, [isSignedIn])

  const seed = useCallback(async () => {
    await apiPost('/dev/seed')
    await refreshAltamyraMe()
  }, [])
  const switchRole = useCallback(async (role: AltamyraRole) => {
    await apiPost('/dev/role', { role })
    await refreshAltamyraMe()
  }, [])

  return { role: snap.role, devEnabled: snap.devEnabled, me: snap.me, schoolId: schoolIdOf(snap.me), loading: snap.status !== 'ready', seed, switchRole, refresh: refreshAltamyraMe }
}
