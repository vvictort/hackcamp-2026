import type { z } from 'zod'
import type { DataPointSourceResponse } from '../contract/api'
import { EventKind } from '../contract/enums'

/**
 * Data point source references (PRD principle 9: every number links to its
 * source). Formats:
 *   photo:<fileKey>#<itemId>
 *   student_response:<sessionId>:<itemKey>
 *   ea_event:<eventKind>:<eventId>
 *   usage:<suggestionId>
 *   teacher:<note>
 */

export type SourceDetail = z.infer<typeof DataPointSourceResponse>['source']

export const photoRef = (fileKey: string, itemId: string | null) => `photo:${fileKey}${itemId ? `#${itemId}` : ''}`
export const studentResponseRef = (sessionId: string, itemKey: string) => `student_response:${sessionId}:${itemKey}`
export const eaEventRef = (kind: EventKind, eventId: string) => `ea_event:${kind}:${eventId}`

const after = (s: string, prefix: string) => s.slice(prefix.length)

export function parseSourceRef(ref: string | null): SourceDetail {
  if (!ref) return { kind: 'teacher', note: null }
  if (ref.startsWith('photo:')) {
    const rest = after(ref, 'photo:')
    const hash = rest.lastIndexOf('#')
    return hash === -1 ? { kind: 'photo', fileKey: rest, itemId: null } : { kind: 'photo', fileKey: rest.slice(0, hash), itemId: rest.slice(hash + 1) }
  }
  if (ref.startsWith('student_response:')) {
    const rest = after(ref, 'student_response:')
    const sep = rest.indexOf(':')
    if (sep > 0) return { kind: 'student_response', sessionId: rest.slice(0, sep), itemId: rest.slice(sep + 1) }
  }
  if (ref.startsWith('ea_event:')) {
    const kind = EventKind.safeParse(after(ref, 'ea_event:').split(':')[0])
    if (kind.success) return { kind: 'ea_event', eventKind: kind.data }
  }
  if (ref.startsWith('usage:')) return { kind: 'usage', suggestionId: after(ref, 'usage:') }
  return { kind: 'teacher', note: ref.startsWith('teacher:') ? after(ref, 'teacher:') : ref }
}
