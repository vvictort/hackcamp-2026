/**
 * Lesson Lens, the pure half: builds the de-identified request sent to the
 * Maritime agent and checks its reply. No worker or network code, so the
 * privacy rules are unit-tested (lesson-lens-core.test.ts).
 *
 * Privacy: the agent sees "Student A", "Student B"... and goal text only.
 * Real names, student ids, profiles and the teacher's id never leave the app;
 * keys map back to real student ids only when the rows are saved.
 */

import { classifyAdaptation } from '../server/altamira/ai/guardrail'
import type { AdaptationType } from '../server/altamira/contract/enums'

/** One row of the student's What works (GET /students/:id/what-works). */
export interface LensWhatWorks {
  adaptationType: AdaptationType
  n: number
  meanOutcome: number | null
  hidden: boolean
}

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
  /** IEP accommodations and strengths: de-identified and sent as context. */
  accommodations?: string[]
  strengths?: string[]
  /** Subjects the IEP modifies (the basis a 'modify' label needs). */
  modificationSubjects?: string[]
  /** 1A-9: past outcomes; used to rank suggestions in the app, never sent. */
  whatWorks?: LensWhatWorks[]
}

export interface LensRequest {
  task: 'lesson-lens'
  teacher: string
  subject: string
  lesson: string
  details?: string
  /** English name of the teacher's language (e.g. "French"); omitted for English. The agent writes its suggestions in it. */
  language?: string
  students: { key: string; goals: LensGoal[]; accommodations?: string[]; strengths?: string[] }[]
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
      ...(s.accommodations?.length ? { accommodations: s.accommodations.slice(0, 10).map((a) => clip(scrub(a), 200)) } : {}),
      ...(s.strengths?.length ? { strengths: s.strengths.slice(0, 10).map((a) => clip(scrub(a), 200)) } : {}),
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

/* ------------------------------------------------------------------ */
/* 1A: typed gaps, adapt/modify guardrail, goal checks, analysis cache */
/* ------------------------------------------------------------------ */


export const GAP_TYPES = ['access', 'skill', 'behaviour', 'engagement', 'communication'] as const
export type GapType = (typeof GAP_TYPES)[number]
export type LensLabel = 'adapt' | 'modify'
export type SuggestionState = 'pending' | 'approved' | 'rejected'

export interface LensGap {
  type: GapType
  text: string
  goalId: string
  goalText: string
  goalArea: string
}
export interface LensCheck {
  /** e.g. "G1-C2": goal number, check number. */
  code: string
  goalId: string
  text: string
}
export interface LensSuggestionView {
  /** Saved suggestions row id (empty until saved). */
  id: string
  goalId: string
  label: LensLabel
  /** Kind of adaptation, guessed in code from the text; matches What works rows. */
  adaptationType: AdaptationType
  text: string
  why: string
  state: SuggestionState
  /** 1A-9: this kind of adaptation had a good outcome for this student before. */
  workedBefore?: boolean
}
export interface StudentAnalysis {
  studentId: string
  name: string
  firstName: string
  gaps: LensGap[]
  suggestions: LensSuggestionView[]
  checks: LensCheck[]
}
export interface LessonAnalysis {
  cached: boolean
  source: 'gemini' | 'rules'
  subject: string
  /** The lesson text the analysis ran on (read from an image when none was typed). */
  lessonText?: string
  students: StudentAnalysis[]
}

const SUBJECT_WORDS: [RegExp, string][] = [
  [/\b(math|numeracy|multipl|fraction|array|add|subtract|number)/i, 'math'],
  [/\b(read|literacy|story|novel|text|poem)/i, 'reading'],
  [/\b(writ|essay|paragraph|sentence)/i, 'writing'],
  [/\b(science|experiment|ecosystem|habitat)/i, 'science'],
  [/\b(social studies|history|geograph|communit)/i, 'social studies'],
]
export const inferSubject = (lesson: string): string => SUBJECT_WORDS.find(([re]) => re.test(lesson))?.[1] ?? 'general'

/** Whitespace- and case-insensitive form used for the cache key. */
export const normalizeLesson = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

export async function analysisCacheKey(userId: string, lesson: string, studentIds: string[]): Promise<string> {
  return sha256Hex(`${userId}\n${normalizeLesson(lesson)}\n${[...new Set(studentIds)].sort().join(',')}`)
}

/** Small in-memory analysis cache (per worker isolate). Oldest entry goes first. */
export class AnalysisCache {
  private m = new Map<string, LessonAnalysis>()
  constructor(private max = 50) {}
  get(key: string): LessonAnalysis | undefined {
    return this.m.get(key)
  }
  set(key: string, v: LessonAnalysis): void {
    this.m.delete(key)
    this.m.set(key, v)
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string)
  }
  clear(): void {
    this.m.clear()
  }
  /** Keeps cached suggestions in step with edits and decisions. */
  update(id: string, patch: Partial<LensSuggestionView>): void {
    for (const a of this.m.values()) for (const st of a.students) for (const s of st.suggestions) if (s.id === id) Object.assign(s, patch)
  }
}

/** Subjects the student's IEP modifies, read from goal areas like "Math (modified)". */
export function modificationSubjects(student: Pick<LensStudent, 'goals' | 'modificationSubjects'>): string[] {
  const fromGoals = student.goals
    .filter((g) => /\bmodif/i.test(g.area))
    .map((g) => g.area.replace(/\(.*?\)/g, '').trim().toLowerCase())
  return [...new Set([...fromGoals, ...(student.modificationSubjects ?? []).map((x) => x.trim().toLowerCase())].filter(Boolean))]
}

/**
 * Code decides the label (PRD 1A-5). 'modify' only when the IEP has a basis
 * for the subject. A model-flagged modification with no basis is downgraded to
 * 'adapt'; one whose own text lowers the outcome is dropped (null).
 */
export function decideLabel(
  s: Pick<LensSuggestion, 'kind' | 'text'>,
  student: Pick<LensStudent, 'goals' | 'modificationSubjects'>,
  subject: string,
): LensLabel | null {
  const r = classifyAdaptation(
    { adaptationType: 'simplified_text' as AdaptationType, text: s.text, changesOutcome: s.kind === 'modification', subject },
    { objectives: [] },
    { modificationSubjects: modificationSubjects(student) },
  )
  if (r.label === 'adaptation') return 'adapt'
  if (r.status === 'draft') return 'modify'
  return r.reasons.every((x) => x === 'outcome_change_flagged') ? 'adapt' : null
}

export function gapTypeFor(area: string): GapType {
  if (/behav|social|self|regulat|conduct/i.test(area)) return 'behaviour'
  if (/communic|speech|language|oral/i.test(area)) return 'communication'
  if (/engag|attention|focus|motiv|participat/i.test(area)) return 'engagement'
  if (/access|vision|hearing|motor|mobility|sensory|physical/i.test(area)) return 'access'
  return 'skill'
}

/** Reads the optional `gaps` list of the agent's reply; unknown keys, goals and types are dropped. */
export function parseGaps(body: unknown, map: LensMap): (LensGap & { studentId: string })[] {
  const raw = (body as { response?: unknown } | null)?.response
  if (typeof raw !== 'string') return []
  let list: unknown
  try {
    list = (JSON.parse(raw) as { gaps?: unknown }).gaps
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const out: (LensGap & { studentId: string })[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const { studentKey: key, goalId, type, text } = item
    if (typeof key !== 'string' || typeof goalId !== 'string' || typeof text !== 'string' || typeof type !== 'string') continue
    const student = map.students.get(key)
    const goal = map.goals.get(goalId)
    if (!student || goal?.key !== key || !(GAP_TYPES as readonly string[]).includes(type)) continue
    const g = student.goals.find((x) => x.id === goal.id)
    const t = clip(restoreNames(text.trim(), map), LIMITS.text)
    if (!g || !t) continue
    out.push({ studentId: student.id, type: type as GapType, text: t, goalId: g.id, goalText: g.text, goalArea: g.area })
  }
  return out
}

/** Deterministic stand-in for the Maritime agent: same reply shape, so it goes through parseReply. */
export function fixtureReply(request: LensRequest): { response: string } {
  const suggestions: unknown[] = []
  const gaps: unknown[] = []
  const lesson = request.lesson || 'this lesson'
  const alt = !!request.details
  for (const s of request.students) {
    s.goals.slice(0, MAX_PER_STUDENT).forEach((g) => {
      const modify = /\bmodif/i.test(g.area)
      gaps.push({ studentKey: s.key, goalId: g.id, type: gapTypeFor(g.area), text: `The task in "${lesson}" needs support for the ${g.area} goal.` })
      suggestions.push({
        studentKey: s.key,
        goalId: g.id,
        kind: modify ? 'modification' : 'adaptation',
        text: modify
          ? `Use a simpler version of the task that targets the IEP goal: ${g.text}.`
          : alt
            ? `Offer a choice of two ways to show the same learning, with a visual support, aimed at: ${g.text}.`
            : `Give a chunked, step-by-step version of the task with a worked example, aimed at: ${g.text}.`,
        why: `Ties the lesson to the student's ${g.area} goal (${g.level}).`,
      })
    })
  }
  return { response: JSON.stringify({ suggestions, gaps, source: 'rules' }) }
}

/** Goal-coded checks: G{goal number}-C{check number}. Goals without a gap or suggestion are skipped. */
export function buildChecks(student: Pick<LensStudent, 'goals'>, goalIds: string[]): LensCheck[] {
  const out: LensCheck[] = []
  student.goals.forEach((g, i) => {
    if (!goalIds.includes(g.id)) return
    out.push(
      { code: `G${i + 1}-C1`, goalId: g.id, text: `Can the student show: ${g.text}?` },
      { code: `G${i + 1}-C2`, goalId: g.id, text: g.level ? `Note evidence toward this goal (now: ${g.level}).` : 'Note evidence toward this goal.' },
    )
  })
  return out
}

/** Guesses the kind of adaptation from its wording, so it can be matched to What works rows. */
export function adaptationTypeFor(text: string, label: LensLabel = 'adapt'): AdaptationType {
  if (label === 'modify') return 'modified_assessment'
  if (/\b(chunk|step[- ]by[- ]step|steps?\b|first[- ]then|break (it|the \w+) (down|into))/i.test(text)) return 'chunked_steps'
  if (/\b(sentence (frame|starter)s?|starters?|word bank|frames?)\b/i.test(text)) return 'sentence_frames'
  if (/\b(visual|picture|diagram|manipulative|icon|image|graphic|colou?r[- ]cod)/i.test(text)) return 'visual_supports'
  if (/\b(dictate|speech[- ]to[- ]text|voice note|record|choice of|two ways|alternative|oral|present|show (the )?learning)/i.test(text)) return 'alternative_demonstration'
  return 'simplified_text'
}

/** A row counts as "worked before" when it is not hidden by the minimum-sample rule and its mean outcome is at least this. */
export const WORKED_BEFORE_MIN = 0.5

const outcomeOf = (type: AdaptationType, ww: LensWhatWorks[] | undefined): number | null => {
  const row = ww?.find((r) => r.adaptationType === type && !r.hidden && r.meanOutcome !== null)
  return row ? (row.meanOutcome as number) : null
}

/**
 * 1A-9: strategies with a good outcome for this student come first (best outcome first),
 * flagged workedBefore. Everything else keeps the agent's order (stable sort).
 */
export function rankSuggestions(list: LensSuggestionView[], ww: LensWhatWorks[] | undefined): LensSuggestionView[] {
  const scored = list.map((s, i) => {
    const o = outcomeOf(s.adaptationType, ww)
    return { s: o !== null && o >= WORKED_BEFORE_MIN ? { ...s, workedBefore: true } : s, o: o !== null && o >= WORKED_BEFORE_MIN ? o : -1, i }
  })
  return scored.sort((a, b) => b.o - a.o || a.i - b.i).map((x) => x.s)
}

/** Per-student analysis from the parsed reply. Suggestions the guardrail drops are left out. */
export function buildAnalysis(input: {
  subject: string
  students: LensStudent[]
  suggestions: LensSuggestion[]
  gaps: (LensGap & { studentId: string })[]
}): StudentAnalysis[] {
  return input.students.map((st) => {
    const suggestions: LensSuggestionView[] = []
    for (const s of input.suggestions.filter((x) => x.studentId === st.id)) {
      const label = decideLabel(s, st, input.subject)
      if (label) suggestions.push({ id: '', goalId: s.goalId, label, adaptationType: adaptationTypeFor(s.text, label), text: s.text, why: s.why, state: 'pending' })
    }
    const gaps = input.gaps.filter((g) => g.studentId === st.id).map(({ studentId: _x, ...g }) => g)
    // A suggestion without a typed gap from the agent still gets one, typed from its goal's area.
    for (const s of suggestions) {
      const goal = st.goals.find((g) => g.id === s.goalId)
      if (goal && !gaps.some((g) => g.goalId === goal.id)) {
        gaps.push({ type: gapTypeFor(goal.area), text: s.why, goalId: goal.id, goalText: goal.text, goalArea: goal.area })
      }
    }
    const goalIds = [...new Set([...gaps.map((g) => g.goalId), ...suggestions.map((s) => s.goalId)])]
    return { studentId: st.id, name: st.name, firstName: st.firstName, gaps, suggestions: rankSuggestions(suggestions, st.whatWorks), checks: buildChecks(st, goalIds) }
  })
}

/** The teacher removes one embedded check. */
export function removeCheck(a: LessonAnalysis, studentId: string, code: string): LessonAnalysis {
  return { ...a, students: a.students.map((s) => (s.studentId === studentId ? { ...s, checks: s.checks.filter((c) => c.code !== code) } : s)) }
}
