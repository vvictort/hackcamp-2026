/**
 * Lesson Lens server actions. The worker loads the teacher's own class and
 * students (never trusting client-sent student data), sends a de-identified
 * request to the Maritime agent, checks the reply and saves suggestions as
 * the teacher's own pending rows. See lesson-lens-core.ts for the privacy rules.
 *
 *   lessonLensSuggest  { classBlockId: string, details?: string } -> { created, source }
 *   lessonLensFeedback { suggestionId: string, decision: 'approved' | 'rejected' } -> { state }
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { AdaptationType } from '../server/altamyra/contract/enums'
import {
  AnalysisCache,
  analysisCacheKey,
  buildAnalysis,
  buildRequest,
  clipLesson,
  fixtureReply,
  inferSubject,
  parseGaps,
  decideLabel,
  adaptationTypeFor,
  rankSuggestions,
  LIMITS,
  type LessonAnalysis,
  type LensSuggestionView,
  parseReply,
  scrubNames,
  sha256Hex,
  type Decision,
  type LensGoal,
  type LensStudent,
} from './lesson-lens-core'
import { findLanguage } from '../i18n/languages'
import { DEMO_IMAGE_TEXT, parseImage, transcribeImage } from './lesson-lens-gemini'

declare module '../../worker' {
  interface Env {
    /** Base URL of the Maritime Lesson Lens agent, e.g. https://lesson-lens.maritime.sh */
    MARITIME_AGENT_URL?: string
    /** Sent as `Authorization: Bearer ...`; must match the agent's AGENT_TOKEN. */
    MARITIME_AGENT_TOKEN?: string
    GEMINI_API_KEY?: string
    ALTAMYRA_GEMINI_MODELS?: string
  }
}

type StudentRow = { ownerId?: string; key: string; name: string; firstName: string; goals: string }
type ClassRow = { ownerId?: string; subject: string; lesson: string; studentIds: string }
type SuggestionRow = { ownerId?: string; studentKey?: string; goalId?: string; kind: string; text: string; why?: string; state: string }

const cache = new AnalysisCache()
const MAX_LESSON = 12_000
// The agent has up to 25 s per Gemini attempt and may try several models.
const AGENT_TIMEOUT_MS = 80_000

const fail = (code: string, error: string): ActionResult => ({ success: false, code, error })

const parseJson = <T,>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return (s as T) ?? fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

const strs = (v: unknown, n: number, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, n).map((x) => x.trim().slice(0, max)) : []
const AD_TYPES: readonly string[] = ['simplified_text', 'chunked_steps', 'sentence_frames', 'visual_supports', 'alternative_demonstration', 'modified_assessment']

/**
 * The students come from the app's /api/v1 caseload (the browser reads goals,
 * accommodations and What works there). Every field is checked and clipped; the
 * server never trusts shape or size. Students without goals are dropped.
 */
export function parseStudents(v: unknown): LensStudent[] {
  if (!Array.isArray(v)) return []
  const out: LensStudent[] = []
  for (const raw of v.slice(0, 60) as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) continue
    const goals = (Array.isArray(raw.goals) ? (raw.goals as Record<string, unknown>[]) : [])
      .filter((g) => g && typeof g.id === 'string' && typeof g.text === 'string' && g.text.trim())
      .slice(0, 12)
      .map((g) => ({ id: String(g.id).slice(0, 80), area: String(g.area ?? '').slice(0, 80), text: String(g.text).slice(0, 600), level: String(g.level ?? '').slice(0, 40) }))
    const whatWorks = (Array.isArray(raw.whatWorks) ? (raw.whatWorks as Record<string, unknown>[]) : [])
      .filter((r) => r && typeof r.adaptationType === 'string' && AD_TYPES.includes(r.adaptationType))
      .slice(0, 10)
      .map((r) => ({
        adaptationType: r.adaptationType as AdaptationType,
        n: Number(r.n) || 0,
        meanOutcome: typeof r.meanOutcome === 'number' ? r.meanOutcome : null,
        hidden: r.hidden === true,
      }))
    const firstName = typeof raw.firstName === 'string' ? raw.firstName.trim().slice(0, 60) : ''
    out.push({
      id: raw.id.slice(0, 80),
      name: (typeof raw.name === 'string' ? raw.name.trim() : firstName).slice(0, 80),
      firstName,
      goals,
      accommodations: strs(raw.accommodations, 10, 200),
      strengths: strs(raw.strengths, 10, 200),
      modificationSubjects: strs(raw.modificationSubjects, 10, 60),
      whatWorks,
    })
  }
  return out.filter((s) => s.goals.length)
}

async function loadRoster(tools: ActionTools, userId: string): Promise<LensStudent[] | null> {
  // ponytail: one page of 500 students; a teacher's caseload is far smaller.
  const res = await tools.query<StudentRow>('students', { where: { ownerId: userId }, limit: 500 })
  if (!res.success) return null
  return res.data.records
    .filter((r) => r.data.ownerId === userId)
    .map((r) => ({
      id: r.data.key,
      name: r.data.name ?? '',
      firstName: r.data.firstName ?? '',
      goals: parseJson<LensGoal[]>(r.data.goals, []).filter((g) => g && typeof g.id === 'string'),
    }))
}

async function callAgent(env: Env, message: object, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`${env.MARITIME_AGENT_URL!.replace(/\/+$/, '')}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.MARITIME_AGENT_TOKEN ? { Authorization: `Bearer ${env.MARITIME_AGENT_TOKEN}` } : {}),
    },
    body: JSON.stringify({ message: JSON.stringify(message) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`agent ${res.status}`)
  // A body that is not JSON is a bad reply (agent_bad_reply), not an outage.
  return res.json().catch(() => null)
}

const lessonLensSuggest: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!env.MARITIME_AGENT_URL) return fail('agent_not_configured', 'Lesson Lens is not connected yet.')
  const classBlockId = params.classBlockId
  if (typeof classBlockId !== 'string' || !classBlockId) return fail('bad_request', 'classBlockId is required.')
  const details = typeof params.details === 'string' ? params.details : undefined
  // The client sends a language code; only a known one becomes a name the agent will use.
  const language = findLanguage(typeof params.language === 'string' ? params.language : undefined)?.name

  const block = await tools.get<ClassRow>('classBlocks', classBlockId)
  if (!block.success || block.data.record.data.ownerId !== userId) return fail('not_found', 'Class not found.')
  const roster = await loadRoster(tools, userId)
  if (!roster) return fail('load_failed', 'Could not load students.')

  const cls = block.data.record.data
  const ids = parseJson<string[]>(cls.studentIds, [])
  const byId = new Map(roster.map((s) => [s.id, s]))
  const inClass = ids.map((id) => byId.get(id)).filter((s): s is LensStudent => !!s)
  const { request, map } = buildRequest({
    teacher: await sha256Hex(userId),
    subject: cls.subject ?? '',
    lesson: cls.lesson ?? '',
    details,
    language,
    inClass,
    roster,
  })
  if (!request.students.length) return { success: true, data: { created: 0, source: 'rules' } }

  let reply
  try {
    reply = parseReply(await callAgent(env, request, AGENT_TIMEOUT_MS), map)
  } catch (e) {
    // The error names a status or a timeout, never the payload.
    console.warn(`[lesson-lens] agent call failed: ${(e as Error).name}`)
    return fail('agent_unreachable', 'Lesson Lens did not answer.')
  }
  if (!reply) return fail('agent_bad_reply', 'Lesson Lens sent a reply we could not read.')

  const lesson = clipLesson(cls.lesson ?? '')
  let created = 0
  for (const s of reply.suggestions) {
    const r = await tools.create('suggestions', {
      ownerId: userId,
      studentKey: s.studentId,
      goalId: s.goalId,
      lesson,
      kind: s.kind,
      text: s.text,
      why: s.why,
      state: 'pending',
    })
    if (r.success) created++
  }
  return { success: true, data: { created, source: reply.source } }
}

const lessonLensFeedback: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const { suggestionId, decision } = params
  if (typeof suggestionId !== 'string' || !suggestionId) return fail('bad_request', 'suggestionId is required.')
  if (decision !== 'approved' && decision !== 'rejected') return fail('bad_request', 'decision must be approved or rejected.')

  const row = await tools.get<SuggestionRow>('suggestions', suggestionId)
  if (!row.success || row.data.record.data.ownerId !== userId) return fail('not_found', 'Suggestion not found.')
  const updated = await tools.update('suggestions', suggestionId, { state: decision })
  if (!updated.success) return updated

  // Best effort: the teacher's decision is saved whatever the agent does.
  if (env.MARITIME_AGENT_URL) {
    const roster = parseStudents(params.students).length ? parseStudents(params.students) : ((await loadRoster(tools, userId)) ?? [])
    const { kind, text } = row.data.record.data
    try {
      await callAgent(
        env,
        { task: 'feedback', teacher: await sha256Hex(userId), kind, text: scrubNames(text ?? '', roster, () => undefined), decision: decision as Decision },
        5_000,
      )
    } catch {
      console.warn('[lesson-lens] feedback not delivered')
    }
  }
  cache.update(suggestionId, { state: decision })
  return { success: true, data: { state: decision } }
}

/** Reads the shared params of analyze and regenerate. */
function lessonParams(params: Record<string, unknown>) {
  const lesson = typeof params.lessonText === 'string' ? params.lessonText.trim().slice(0, MAX_LESSON) : ''
  const subject = typeof params.subject === 'string' && params.subject.trim() ? params.subject.trim().slice(0, 80) : inferSubject(lesson)
  const language = findLanguage(typeof params.language === 'string' ? params.language : undefined)?.name
  return { lesson, subject, language }
}

/** One agent round (or the local fixture when no agent is set up). */
async function runLens(env: Env, request: ReturnType<typeof buildRequest>['request']) {
  if (!env.MARITIME_AGENT_URL) return fixtureReply(request)
  return callAgent(env, request, AGENT_TIMEOUT_MS)
}

/**
 * 1A: analyze one lesson for a set of students. Same lesson + same students
 * returns the cached analysis. Suggestions are saved as pending rows.
 */
const lessonLensAnalyze: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const { subject: givenSubject, language } = lessonParams(params)
  let { lesson } = lessonParams(params)
  const image = parseImage(params.image)
  if (!lesson && !image) return fail('bad_request', 'lessonText or image is required.')
  const roster = parseStudents(params.students)
  const wanted = Array.isArray(params.studentIds) ? new Set((params.studentIds as unknown[]).filter((x): x is string => typeof x === 'string')) : null
  const selected = roster.filter((s) => !wanted || wanted.has(s.id))
  if (!selected.length) return fail('no_students', 'No students with IEP goals to analyze.')

  // An image is keyed by its bytes, so the same photo hits the cache without a Gemini call.
  const keyText = lesson || `image:${await sha256Hex(image!.data)}`
  const subjectKey = givenSubject
  const key = await analysisCacheKey(userId, `${subjectKey}\n${keyText}`, selected.map((s) => s.id))
  const hit = cache.get(key)
  if (hit) return { success: true, data: { ...hit, cached: true } }

  if (!lesson && image) {
    lesson = ((await transcribeImage(env, image)) ?? (env.GEMINI_API_KEY ? '' : DEMO_IMAGE_TEXT)).slice(0, MAX_LESSON)
    if (!lesson) return fail('image_unreadable', 'No lesson text could be read from the image.')
  }
  const subject = params.subject && typeof params.subject === 'string' && params.subject.trim() ? givenSubject : inferSubject(lesson)

  const { request, map } = buildRequest({ teacher: await sha256Hex(userId), subject, lesson, language, inClass: selected, roster })
  let body: unknown
  try {
    body = await runLens(env, request)
  } catch (e) {
    console.warn(`[lesson-lens] agent call failed: ${(e as Error).name}`)
    return fail('agent_unreachable', 'Lesson Lens did not answer.')
  }
  const reply = parseReply(body, map)
  if (!reply) return fail('agent_bad_reply', 'Lesson Lens sent a reply we could not read.')

  const students = buildAnalysis({ subject, students: [...map.students.values()], suggestions: reply.suggestions, gaps: parseGaps(body, map) })
  const clipped = clipLesson(lesson)
  for (const st of students) {
    for (const s of st.suggestions) {
      const r = await tools.create('suggestions', {
        ownerId: userId, studentKey: st.studentId, goalId: s.goalId, lesson: clipped,
        kind: s.label === 'modify' ? 'modification' : 'adaptation', text: s.text, why: s.why, state: 'pending',
      })
      s.id = r.success ? r.data.recordId : ''
    }
  }
  const analysis: LessonAnalysis = { cached: false, source: reply.source, subject, lessonText: lesson, students }
  cache.set(key, analysis)
  return { success: true, data: analysis }
}

/** Regenerates one suggestion in place (new text, back to pending). */
const lessonLensRegenerate: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const { lesson, subject, language } = lessonParams(params)
  const id = params.suggestionId
  if (typeof id !== 'string' || !id || !lesson) return fail('bad_request', 'suggestionId and lessonText are required.')
  const row = await tools.get<SuggestionRow>('suggestions', id)
  if (!row.success || row.data.record.data.ownerId !== userId) return fail('not_found', 'Suggestion not found.')
  const old = row.data.record.data
  const roster = parseStudents(params.students)
  const student = roster.find((s) => s.id === old.studentKey)
  if (!student) return fail('not_found', 'Student not found.')

  const { request, map } = buildRequest({
    teacher: await sha256Hex(userId), subject, lesson, language, inClass: [student], roster,
    details: `Offer a different approach than: ${old.text ?? ''}`,
  })
  let body: unknown
  try {
    body = await runLens(env, request)
  } catch {
    return fail('agent_unreachable', 'Lesson Lens did not answer.')
  }
  const reply = parseReply(body, map)
  if (!reply) return fail('agent_bad_reply', 'Lesson Lens sent a reply we could not read.')
  const pick = reply.suggestions.find((s) => s.goalId === old.goalId) ?? reply.suggestions[0]
  const label = pick ? decideLabel(pick, student, subject) : null
  if (!pick || !label) return fail('agent_bad_reply', 'Lesson Lens had no new suggestion.')
  const upd = await tools.update('suggestions', id, { text: pick.text, why: pick.why, kind: label === 'modify' ? 'modification' : 'adaptation', goalId: pick.goalId, state: 'pending' })
  if (!upd.success) return upd
  const view = rankSuggestions(
    [{ id, goalId: pick.goalId, label, adaptationType: adaptationTypeFor(pick.text, label), text: pick.text, why: pick.why, state: 'pending' } as LensSuggestionView],
    student.whatWorks,
  )[0]!
  cache.update(id, { ...view, workedBefore: view.workedBefore ?? false })
  return { success: true, data: { ...view, workedBefore: view.workedBefore ?? false } }
}

/** The teacher's own wording for a suggestion. */
const lessonLensEdit: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const id = params.suggestionId
  const text = typeof params.text === 'string' ? params.text.trim().slice(0, LIMITS.text) : ''
  if (typeof id !== 'string' || !id || !text) return fail('bad_request', 'suggestionId and text are required.')
  const row = await tools.get<SuggestionRow>('suggestions', id)
  if (!row.success || row.data.record.data.ownerId !== userId) return fail('not_found', 'Suggestion not found.')
  const upd = await tools.update('suggestions', id, { text })
  if (!upd.success) return upd
  cache.update(id, { text })
  return { success: true, data: { text } }
}

export const lessonLensActions = { lessonLensSuggest, lessonLensFeedback, lessonLensAnalyze, lessonLensRegenerate, lessonLensEdit }
