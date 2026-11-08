/**
 * Lesson Lens, the pure half: builds the de-identified request sent to the
 * Maritime agent and checks its reply. No worker or network code, so the
 * privacy rules are unit-tested (lesson-lens-core.test.ts).
 *
 * Privacy: the agent sees "Student A", "Student B"... and goal text only.
 * Real names, student ids, profiles and the teacher's id never leave the app;
 * keys map back to real student ids only when the rows are saved.
 */

export type Kind = 'adaptation' | 'modification'
export type Decision = 'approved' | 'rejected'

export interface LensGoal {
  id: string
  area: string
  text: string
  level: string
}
export interface LensStudent {
  /** The app's student id (the `key` column). Never sent. */
  id: string
  name: string
  firstName: string
  goals: LensGoal[]
}

export interface LensRequest {
  task: 'lesson-lens'
  teacher: string
  subject: string
  lesson: string
  details?: string
  /** English name of the teacher's language (e.g. "French"); omitted for English. The agent writes its suggestions in it. */
  language?: string
  students: { key: string; goals: LensGoal[] }[]
}

export interface LensSuggestion {
  /** Real student id, mapped back from the key. */
  studentId: string
  goalId: string
  kind: Kind
  text: string
  why: string
}

/** What the reply is checked against: key -> student, sent goal id -> real goal. */
export interface LensMap {
  students: Map<string, LensStudent>
  goals: Map<string, { key: string; id: string }>
}

/** Column limits from src/schemas/classroom-schema.ts (suggestions). */
export const LIMITS = { lesson: 80, text: 600, why: 600, details: 4000 } as const
export const MAX_PER_STUDENT = 2

const KINDS: readonly string[] = ['adaptation', 'modification']

export const studentKey = (i: number): string => {
  // A..Z, then AA, AB... so a big roster never repeats a key.
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `Student ${s}`
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NOT_WORD = '[\\p{L}\\p{N}\\p{M}]'

/** "Sofía" -> a pattern matching sofia, SOFÍA, Sofía... on NFD text: each letter may carry any accent. */
const namePattern = (name: string) =>
  [...name.normalize('NFD').replace(/\p{M}/gu, '')].map((c) => `${escapeRe(c)}\\p{M}*`).join('')

/**
 * Replaces every first, last and full name of every given student with their
 * key (or "a student" for someone not in this class). Whole words only,
 * case- and accent-insensitive, longest names first so "Kai Nakamura"
 * becomes one key, not two. Hyphenated names are also matched part by part.
 */
export function scrubNames(text: string, roster: LensStudent[], keyOf: (id: string) => string | undefined): string {
  const pairs: [string, string][] = []
  for (const s of roster) {
    const key = keyOf(s.id) ?? 'a student'
    const parts = [s.name, s.firstName, ...s.name.split(/[\s-]+/), ...s.firstName.split(/[\s-]+/)].map((p) => p.trim()).filter((p) => p.length > 1)
    for (const p of new Set(parts)) pairs.push([p, key])
  }
  pairs.sort((a, b) => b[0].length - a[0].length)
  let out = text.normalize('NFD')
  for (const [name, key] of pairs) {
    out = out.replace(new RegExp(`(?<!${NOT_WORD})${namePattern(name)}(?!${NOT_WORD})`, 'giu'), key)
  }
  return out.normalize('NFC')
}

/** The other way, inside the app only: "Student A" in the agent's text becomes that student's first name. */
const restoreNames = (text: string, map: LensMap) =>
  text.replace(/\bStudent [A-Z]+\b/g, (k) => {
    const s = map.students.get(k)
    return s ? s.firstName || s.name : k
  })

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() : s)

/**
 * The outgoing payload. `inClass` are the class's students (in class order);
 * `roster` is every student the teacher has, so a name from another class
 * pasted into the details is removed too. Students without goals are left out.
 */
export function buildRequest(input: {
  teacher: string
  subject: string
  lesson: string
  details?: string
  language?: string
  inClass: LensStudent[]
  roster: LensStudent[]
}): { request: LensRequest; map: LensMap } {
  const keys = new Map<string, LensStudent>()
  // Goal ids are app data (often built from a first name, like "kai-r"), so
  // the agent gets "g1", "g2"... instead.
  const goals = new Map<string, { key: string; id: string }>()
  const keyById = new Map<string, string>()
  for (const s of input.inClass) {
    if (!s.goals.length || keyById.has(s.id)) continue
    const key = studentKey(keys.size)
    keys.set(key, s)
    keyById.set(s.id, key)
  }
  const roster = [...input.roster, ...input.inClass]
  const scrub = (t: string) => scrubNames(t, roster, (id) => keyById.get(id))
  // Scrub before clipping: clipping first could cut a name ("Nakam") so it no longer matches.
  const details = clip(scrub((input.details ?? '').trim().slice(0, LIMITS.details * 2)), LIMITS.details)
  const request: LensRequest = {
    task: 'lesson-lens',
    teacher: input.teacher,
    subject: scrub(input.subject),
    lesson: scrub(input.lesson),
    ...(details ? { details } : {}),
    ...(input.language && input.language !== 'English' ? { language: input.language } : {}),
    students: [...keys].map(([key, s]) => ({
      key,
      goals: s.goals.map((g) => {
        const id = `g${goals.size + 1}`
        goals.set(id, { key, id: g.id })
        return { id, area: scrub(g.area), text: scrub(g.text), level: scrub(g.level) }
      }),
    })),
  }
  return { request, map: { students: keys, goals } }
}

/**
 * Strictly reads the agent's reply body ({ response: "<json string>" }).
 * Anything unknown is dropped: a key not in this request, a goal that is not
 * that student's, a kind outside the two, empty text. Text is clipped to the
 * columns. Returns null when the body is not the expected shape at all.
 */
export function parseReply(
  body: unknown,
  map: LensMap,
): { suggestions: LensSuggestion[]; source: 'gemini' | 'rules' } | null {
  const raw = (body as { response?: unknown } | null)?.response
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const list = (parsed as { suggestions?: unknown } | null)?.suggestions
  if (!Array.isArray(list)) return null
  const source = (parsed as { source?: unknown }).source === 'gemini' ? 'gemini' : 'rules'
  const perStudent = new Map<string, number>()
  const suggestions: LensSuggestion[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const { studentKey: key, goalId, kind, text, why } = item
    if (typeof key !== 'string' || typeof goalId !== 'string' || typeof text !== 'string' || typeof why !== 'string') continue
    const student = map.students.get(key)
    const goal = map.goals.get(goalId)
    if (!student || goal?.key !== key) continue
    if (typeof kind !== 'string' || !KINDS.includes(kind)) continue
    const t = clip(restoreNames(text.trim(), map), LIMITS.text)
    const w = clip(restoreNames(why.trim(), map), LIMITS.why)
    if (!t || !w) continue
    const n = perStudent.get(key) ?? 0
    if (n >= MAX_PER_STUDENT) continue
    perStudent.set(key, n + 1)
    suggestions.push({ studentId: student.id, goalId: goal.id, kind: kind as Kind, text: t, why: w })
  }
  return { suggestions, source }
}

export const clipLesson = (lesson: string): string => clip(lesson.trim(), LIMITS.lesson)

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
