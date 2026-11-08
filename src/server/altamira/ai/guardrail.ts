import type { AdaptationType, Label } from '../contract/enums'
import type { LessonAnalysisBody } from '../contract/school'
import type { IepVersion } from '../contract/student'

/**
 * PRD 1A-5: the adapt/modify guardrail is decided in code. Any change to the
 * learning outcome is a modification, whatever the model's own label says,
 * and a modification is blocked unless the IEP authorizes modification for
 * the lesson's subject.
 */

export type GuardrailAdaptation = {
  adaptationType: AdaptationType
  text: string
  title?: string
  /** The model's claim that the outcome changes. Trusted only in the direction of "modification". */
  changesOutcome: boolean
  /** Recorded for evals only; never used to decide (PRD 1A-5). */
  modelLabel?: Label | null
  /** Subject key of the lesson, e.g. "math". */
  subject: string
}

export type GuardrailReason =
  /** The model said the learning outcome changes. */
  | 'outcome_change_flagged'
  /** A modified assessment assesses a different outcome. */
  | 'modified_assessment'
  /** The text says the outcome or expectation is lowered, modified or replaced. */
  | 'reduces_outcome'
  /** The text replaces, skips or removes one of the lesson's own objectives. */
  | 'replaces_lesson_objective'

export type GuardrailResult = {
  label: Label
  /** Suggestion status to store: "blocked" for an unauthorized modification. */
  status: 'draft' | 'blocked'
  reasons: GuardrailReason[]
  /** True when the code's label differs from the model's label. */
  modelLabelOverridden: boolean
}

const REDUCES_OUTCOME_RE = new RegExp(
  [
    String.raw`\bmodif(?:y|ied|ies)\s+(?:the\s+)?(?:learning\s+)?(?:outcome|goal|expectation|curriculum)s?\b`,
    String.raw`\b(?:lower|lowered|reduced?|different|simpler|easier)\s+(?:learning\s+)?(?:outcome|goal|expectation|grade[-\s]level)s?\b`,
    String.raw`\bbelow\s+grade[-\s]level\s+(?:outcome|expectation|standard)s?\b`,
    String.raw`\b(?:in\s+place\s+of|instead\s+of)\s+(?:the\s+)?grade[-\s]level\s+(?:outcome|expectation|goal|standard)s?\b`,
  ].join('|'),
  'i',
)

/** A cue that something is replaced or left out, followed by what is replaced. */
const REPLACE_CUE_RE = /\b(?:instead\s+of|rather\s+than|in\s+place\s+of|replac\w*|skip\w*|remov\w*|omit\w*|drop\w*|leave\s+out|not\s+required\s+to)\s+([^,.;:!?]{1,120})/gi

const STOPWORDS = new Set([
  'with', 'that', 'this', 'from', 'into', 'about', 'their', 'them', 'they', 'will', 'each', 'only', 'more', 'less',
  'some', 'then', 'than', 'when', 'what', 'have', 'student', 'students', 'lesson', 'task', 'tasks', 'part', 'parts',
])

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '')

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      .map(stem),
  )
}

/** Two or more shared content words between a replaced clause and a lesson objective. */
function replacesObjective(text: string, objectives: string[]): boolean {
  const objectiveWords = objectives.map(contentWords)
  for (const m of text.matchAll(REPLACE_CUE_RE)) {
    const clause = m[1].split(/\b(?:so|and\s+then|while|but)\b/i)[0]
    const words = contentWords(clause)
    if (objectiveWords.some((ow) => [...words].filter((w) => ow.has(w)).length >= 2)) return true
  }
  return false
}

const normSubject = (s: string) => s.trim().toLowerCase()

export function isModificationAuthorized(subject: string, iep: Pick<IepVersion, 'modificationSubjects'>): boolean {
  return iep.modificationSubjects.map(normSubject).includes(normSubject(subject))
}

export function classifyAdaptation(
  adaptation: GuardrailAdaptation,
  lessonAnalysis: Pick<LessonAnalysisBody, 'objectives'>,
  iep: Pick<IepVersion, 'modificationSubjects'>,
): GuardrailResult {
  const text = `${adaptation.title ?? ''}\n${adaptation.text}`
  const reasons: GuardrailReason[] = []
  if (adaptation.changesOutcome) reasons.push('outcome_change_flagged')
  if (adaptation.adaptationType === 'modified_assessment') reasons.push('modified_assessment')
  if (REDUCES_OUTCOME_RE.test(text)) reasons.push('reduces_outcome')
  if (replacesObjective(text, lessonAnalysis.objectives)) reasons.push('replaces_lesson_objective')

  // PRD 1A-5: any outcome change is a modification; the model's label is ignored.
  const label: Label = reasons.length > 0 ? 'modification' : 'adaptation'
  const status = label === 'modification' && !isModificationAuthorized(adaptation.subject, iep) ? 'blocked' : 'draft'
  return {
    label,
    status,
    reasons,
    modelLabelOverridden: adaptation.modelLabel != null && adaptation.modelLabel !== label,
  }
}
