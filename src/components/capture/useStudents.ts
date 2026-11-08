import { useCallback, useEffect, useState } from 'react'
import type { MeResponse } from '@/server/altamira/contract/api'
import { getMe } from '@/lib/altamira/capture-api'

export type StudentSummary = MeResponse['students'][number]

/** Students the signed-in user can see, from GET /me (caseload first, then others, no duplicates). */
export function useStudents() {
  const [students, setStudents] = useState<StudentSummary[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const load = useCallback(() => {
    setState('loading')
    getMe()
      .then((me) => {
        const seen = new Set<string>()
        setStudents([...me.caseload, ...me.students].filter((s) => !seen.has(s.id) && seen.add(s.id)))
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [])
  useEffect(load, [load])
  return { students, state, reload: load }
}
