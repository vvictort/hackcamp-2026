import { FAMILY_VISIBLE_STATUSES, type DataPointStatus, type Proficiency } from '../contract/enums'
import { AltamyraError } from '../contract/errors'

/**
 * Code checks on Progress Drafts (design doc "Citation check"; PRD Progress
 * Drafts and BC reporting rules). The model drafts; these functions decide.
 */

export type CitableDataPoint = { id: string; studentId: string; status: DataPointStatus }

export type CitationProblem = {
  sentenceIndex: number
  dataPointId: string
  reason: 'not_found' | 'other_student' | 'not_confirmed'
}

export type CitationResult = { ok: true } | { ok: false; problems: CitationProblem[] }

type DraftLike = { sentences: { citations: string[] }[] }

const CITABLE: readonly DataPointStatus[] = FAMILY_VISIBLE_STATUSES

/** Rejects a draft if any cited id is unknown, belongs to another student, or is not confirmed or auto-confirmed. */
export function checkCitations(draft: DraftLike, dataPoints: CitableDataPoint[], studentId: string): CitationResult {
  const byId = new Map(dataPoints.map((p) => [p.id, p]))
  const problems: CitationProblem[] = []
  draft.sentences.forEach((s, sentenceIndex) => {
    for (const dataPointId of s.citations) {
      const p = byId.get(dataPointId)
      if (!p) problems.push({ sentenceIndex, dataPointId, reason: 'not_found' })
      else if (p.studentId !== studentId) problems.push({ sentenceIndex, dataPointId, reason: 'other_student' })
      else if (!CITABLE.includes(p.status)) problems.push({ sentenceIndex, dataPointId, reason: 'not_confirmed' })
    }
  })
  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

/** checkCitations that throws bad_request, for use inside a room op or route. */
export function assertCitations(draft: DraftLike, dataPoints: CitableDataPoint[], studentId: string): void {
  const result = checkCitations(draft, dataPoints, studentId)
  if (!result.ok) {
    const detail = result.problems.map((p) => `sentence ${p.sentenceIndex}: ${p.dataPointId} ${p.reason}`).join('; ')
    throw new AltamyraError('bad_request', `Draft rejected, invalid citations: ${detail}`)
  }
}

// ---------- BC reporting rules ----------

export type ReportingDraft = {
  sentences: { text: string; citations: string[] }[]
  proficiencySuggestion: Proficiency | null
}

export type ReportingFlags = {
  /** True when the data minimum for this goal is not met (from analytics). */
  insufficientEvidence: boolean
}

export type ReportingProblem = 'missing_iep_relation_statement' | 'ie_not_suggested'

export const IEP_RELATION_STATEMENT = 'Any proficiency scale indicator in this report is in relation to the student’s IEP goals.'
export const IE_STATEMENT = 'There is not yet enough evidence for this goal, so IE (insufficient evidence) is suggested.'

const RELATION_RE = /\bin relation to\b[^.]*\bIEP goals?\b/i

/** Lists which BC reporting rules a draft breaks. */
export function checkReportingRules(draft: ReportingDraft, flags: ReportingFlags): ReportingProblem[] {
  const problems: ReportingProblem[] = []
  // PRD Progress Drafts / Inclusive Education Reporting Guide: suggest IE when the data minimum isn't met.
  if (flags.insufficientEvidence && draft.proficiencySuggestion !== 'IE') problems.push('ie_not_suggested')
  // PRD: state that any scale indicator is in relation to IEP goals.
  const suggestion = flags.insufficientEvidence ? 'IE' : draft.proficiencySuggestion
  if (suggestion !== null && !draft.sentences.some((s) => RELATION_RE.test(s.text))) problems.push('missing_iep_relation_statement')
  return problems
}

/**
 * Returns the draft with the BC reporting rules applied: IE replaces any
 * suggestion when evidence is insufficient, and the IEP-relation statement is
 * added when a scale indicator is present. Never fills in a level on its own,
 * so an IEP student is never defaulted to Emerging or Developing (PRD).
 * Added statements carry no citations; run checkCitations on the model's sentences first.
 */
export function applyReportingRules<D extends ReportingDraft>(draft: D, flags: ReportingFlags): D {
  const proficiencySuggestion: Proficiency | null = flags.insufficientEvidence ? 'IE' : draft.proficiencySuggestion
  const sentences = [...draft.sentences]
  if (flags.insufficientEvidence && !sentences.some((s) => s.text === IE_STATEMENT)) {
    sentences.push({ text: IE_STATEMENT, citations: [] })
  }
  if (proficiencySuggestion !== null && !sentences.some((s) => RELATION_RE.test(s.text))) {
    sentences.push({ text: IEP_RELATION_STATEMENT, citations: [] })
  }
  return { ...draft, sentences, proficiencySuggestion }
}
