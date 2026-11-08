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
import {
  buildRequest,
  clipLesson,
  parseReply,
  scrubNames,
  sha256Hex,
  type Decision,
  type LensGoal,
  type LensStudent,
} from './lesson-lens-core'

declare module '../../worker' {
  interface Env {
    /** Base URL of the Maritime Lesson Lens agent, e.g. https://lesson-lens.maritime.sh */
    MARITIME_AGENT_URL?: string
    /** Sent as `Authorization: Bearer ...`; must match the agent's AGENT_TOKEN. */
    MARITIME_AGENT_TOKEN?: string
  }
}

type StudentRow = { ownerId?: string; key: string; name: string; firstName: string; goals: string }
type ClassRow = { ownerId?: string; subject: string; lesson: string; studentIds: string }
type SuggestionRow = { ownerId?: string; kind: string; text: string; state: string }

const fail = (code: string, error: string): ActionResult => ({ success: false, code, error })

const parseJson = <T,>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return (s as T) ?? fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
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
    inClass,
    roster,
  })
  if (!request.students.length) return { success: true, data: { created: 0, source: 'rules' } }

  let reply
  try {
    reply = parseReply(await callAgent(env, request, 25_000), map)
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
    const roster = (await loadRoster(tools, userId)) ?? []
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
  return { success: true, data: { state: decision } }
}

export const lessonLensActions = { lessonLensSuggest, lessonLensFeedback }
