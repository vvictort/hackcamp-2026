import { useEffect, useState } from 'react'
import { getAuthToken } from 'deepspace'
import { API_BASE } from '@/lib/altamyra/capture-api'

/** Whether the family allows voice notes: 'unknown' until read; a failed read stays 'unknown' and the server still gates the upload. */
export function useVoiceConsent(studentId: string): 'unknown' | 'allowed' | 'denied' {
  const [state, setState] = useState<'unknown' | 'allowed' | 'denied'>('unknown')
  useEffect(() => {
    setState('unknown')
    let live = true
    void (async () => {
      try {
        const token = await getAuthToken().catch(() => null)
        const res = await fetch(`${API_BASE}/students/${encodeURIComponent(studentId)}/capture-consent`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) return
        const json = (await res.json()) as { voiceNote?: boolean }
        if (live) setState(json.voiceNote ? 'allowed' : 'denied')
      } catch {
        /* leave unknown */
      }
    })()
    return () => {
      live = false
    }
  }, [studentId])
  return state
}
