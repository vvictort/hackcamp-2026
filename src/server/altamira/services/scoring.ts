import type { AnswerKeyEntry, CheckItem } from '../contract/student'

/**
 * Deterministic scoring of objective items against the answer key (design
 * doc "Rules in code around the model": student-mode objective items are
 * scored in code, never by the model).
 */

const OBJECTIVE_FORMATS: readonly CheckItem['format'][] = ['multiple_choice', 'short_answer', 'numeric']

/** Work samples need a rubric and a person; they are never scored here. */
export const isObjectiveItem = (item: CheckItem) => OBJECTIVE_FORMATS.includes(item.format)

const normaliseText = (s: string) =>
  s
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')

const asNumber = (s: string): number | null => {
  const cleaned = s.trim().replace(/,/g, '')
  if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) return null
  return Number(cleaned)
}

/** True or false for an objective item with a key; null when the item cannot be scored in code. */
export function scoreItem(item: CheckItem, key: AnswerKeyEntry | undefined, response: string): boolean | null {
  if (!isObjectiveItem(item) || !key || key.accepted.length === 0) return null
  if (item.format === 'numeric') {
    const given = asNumber(response)
    return given !== null && key.accepted.some((a) => asNumber(a) === given)
  }
  const given = normaliseText(response)
  return key.accepted.some((a) => normaliseText(a) === given)
}
