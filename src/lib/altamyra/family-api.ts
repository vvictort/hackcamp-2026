/**
 * Family view client: the approved summary, progress and consent toggles for a
 * parent's own child, over the Altamyra /api/v1 backend.
 */
import { apiFetch, emptyOn404, enc } from './api'

/** An approved monthly summary: English text plus the family-language version. */
export type FamilySummary = {
  id: string
  period: string
  text: string
  translatedText?: string | null
  language?: string | null
  approvedAt?: string | null
}

/** Consent kinds a parent controls. Typed locally; the server owns the list. */
export const FAMILY_CONSENT_KINDS = ['voice_note', 'video'] as const
export type FamilyConsentKind = (typeof FAMILY_CONSENT_KINDS)[number]
export type Consent = { kind: string; grantedAt: string; revokedAt?: string | null }

export const getFamilySummaries = (studentId: string): Promise<FamilySummary[]> =>
  emptyOn404(
    apiFetch<{ summaries: FamilySummary[] }>(`/family/${enc(studentId)}/summaries`).then((r) => [...r.summaries].sort((a, b) => b.period.localeCompare(a.period))),
    [],
  )

/** What the parent reads: the family-language text when there is one, else English. */
export const familyText = (s: FamilySummary) => (s.translatedText?.trim() ? { text: s.translatedText, lang: s.language || 'en' } : { text: s.text, lang: 'en' })
export const setConsent = (studentId: string, body: { kind: FamilyConsentKind; granted: boolean }) =>
  apiFetch<{ consents: Consent[] }>(`/family/${enc(studentId)}/consents`, { method: 'PUT', body })

/** Every consent row for the child; the toggles show the newest row per kind. */
export const getConsents = (studentId: string): Promise<Consent[]> =>
  emptyOn404(apiFetch<{ consents: Consent[] }>(`/family/${enc(studentId)}/consents`).then((r) => r.consents), [])

/** A kind is on when its newest row is not revoked. */
export function consentActive(consents: Consent[], kind: FamilyConsentKind): boolean {
  const rows = consents.filter((c) => c.kind === kind).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
  return rows.length > 0 && !rows[0].revokedAt
}
