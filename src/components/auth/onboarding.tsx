/**
 * OAuth always lands on /home, so a brand-new account would skip the sign-up
 * profile stages. Sign-up sets a session flag before leaving for OAuth; /home
 * (via <OnboardingRedirect />) sends a flagged, signed-in user whose profile
 * is incomplete back to /sign-up. Visitors who never started sign-up have no
 * flag and are never redirected.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useUser } from 'deepspace'

const FLAG = 'altamyra.onboarding'
/** Sign-up answers kept across a refresh. */
export const DRAFT_KEY = 'altamyra.signup-draft'

export interface Profile {
  school?: string
  position?: string
  language?: string
  consentAt?: string
}

export const isComplete = (d?: Profile) => Boolean(d?.school && d.position)

// sessionStorage can throw (blocked site data); onboarding then just doesn't resume.
function withStorage<T>(fn: (s: Storage) => T, fallback: T): T {
  try {
    return fn(sessionStorage)
  } catch {
    return fallback
  }
}

export const startOnboarding = () => withStorage((s) => s.setItem(FLAG, '1'), undefined)
export const endOnboarding = () =>
  withStorage((s) => {
    s.removeItem(FLAG)
    s.removeItem(DRAFT_KEY)
  }, undefined)
export const loadDraft = <T,>(): Partial<T> =>
  withStorage((s) => JSON.parse(s.getItem(DRAFT_KEY) ?? '{}') as Partial<T>, {})
export const saveDraft = (draft: object) => withStorage((s) => s.setItem(DRAFT_KEY, JSON.stringify(draft)), undefined)

/** Renders nothing. Reads the flag after mount (no storage during render),
 *  and only then subscribes to `users`, so unflagged visits cost nothing. */
export function OnboardingRedirect() {
  const [flagged, setFlagged] = useState(false)
  useEffect(() => setFlagged(withStorage((s) => s.getItem(FLAG) === '1', false)), [])
  return flagged ? <ResumeOnboarding /> : null
}

function ResumeOnboarding() {
  const navigate = useNavigate()
  const { user } = useUser()
  const { records, status } = useQuery<Profile>('users')
  // The users record id is the user id; admins can read other rows.
  const complete = isComplete(records.find((r) => r.recordId === user?.id)?.data)

  useEffect(() => {
    if (!user || status !== 'ready') return
    if (complete) endOnboarding()
    else navigate('/sign-up', { replace: true })
  }, [user, status, complete, navigate])
  return null
}
