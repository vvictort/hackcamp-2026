import { getCaptureConsent } from '@/lib/altamyra/capture-api'
import { useLoad } from '@/lib/useLoad'

/** Whether the family allows voice notes: 'unknown' until read; a failed read stays 'unknown' and the server still gates the upload. */
export function useVoiceConsent(studentId: string): 'unknown' | 'allowed' | 'denied' {
  const consent = useLoad(() => getCaptureConsent(studentId), studentId)
  if (consent.status !== 'ready') return 'unknown'
  return consent.data.voiceNote ? 'allowed' : 'denied'
}
