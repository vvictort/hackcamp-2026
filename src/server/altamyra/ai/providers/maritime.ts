import { z } from 'zod'
import { AI_SCHEMAS, type AiProvider, type LensForStudentInput, type LensForStudentOutput } from '../../contract/ai'
import type { AdaptationType, GapType } from '../../contract/enums'

export const MARITIME_TIMEOUT_MS = 25_000

export type MaritimeEnv = { MARITIME_AGENT_URL?: string; MARITIME_AGENT_TOKEN?: string }
export type MaritimeAgent = { url: string; token: string; timeoutMs?: number; fetch?: typeof fetch }
export type MaritimeConfig = MaritimeAgent & { teacher: string }
export type MaritimeFeedback = { teacher: string; kind: string; text: string; decision: 'approved' | 'rejected' }

class AgentError extends Error {}

export function maritimeAgent(env: MaritimeEnv): MaritimeAgent | null {
  const url = env.MARITIME_AGENT_URL?.trim()
  const token = env.MARITIME_AGENT_TOKEN?.trim()
  return url && token ? { url, token } : null
}

export async function teacherHash(userId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function chat(agent: MaritimeAgent, message: object): Promise<string> {
  const doFetch = agent.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const res = await doFetch(`${agent.url.replace(/\/+$/, '')}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agent.token}` },
    body: JSON.stringify({ message: JSON.stringify(message) }),
    signal: AbortSignal.timeout(agent.timeoutMs ?? MARITIME_TIMEOUT_MS),
  })
  if (!res.ok) throw new AgentError(`http_${res.status}`)
  const body = (await res.json()) as { response?: unknown } | null
  if (typeof body?.response !== 'string') throw new AgentError('bad_reply')
  return body.response
}

export const maritimeFeedback = (agent: MaritimeAgent, f: MaritimeFeedback) => chat(agent, { task: 'feedback', ...f })

const Suggestion = z.object({
  studentKey: z.string(),
  goalId: z.string(),
  kind: z.enum(['adaptation', 'modification']),
  text: z.string().trim().min(1),
  why: z.string().trim(),
})
const Gap = z.object({ studentKey: z.string(), goalId: z.string(), type: z.enum(['access', 'skill', 'behaviour', 'engagement', 'communication']), text: z.string().trim().min(1) })
const Reply = z.object({ suggestions: z.array(z.unknown()), gaps: z.array(z.unknown()).optional() })

const GAP_TYPES: Record<z.infer<typeof Gap>['type'], GapType> = { access: 'access', engagement: 'engagement', skill: 'goal', behaviour: 'goal', communication: 'goal' }

const TITLES: Record<AdaptationType, string> = {
  simplified_text: 'Simplified text',
  chunked_steps: 'Chunked steps',
  sentence_frames: 'Sentence frames',
  visual_supports: 'Visual supports',
  alternative_demonstration: 'Another way to show learning',
  modified_assessment: 'Modified task',
}

function adaptationTypeFor(text: string, modify: boolean): AdaptationType {
  if (modify) return 'modified_assessment'
  if (/\b(chunk|step[- ]by[- ]step|steps?\b|first[- ]then|break (it|the \w+) (down|into))/i.test(text)) return 'chunked_steps'
  if (/\b(sentence (frame|starter)s?|starters?|word bank|frames?)\b/i.test(text)) return 'sentence_frames'
  if (/\b(visual|picture|diagram|manipulative|icon|image|graphic|colou?r[- ]cod)/i.test(text)) return 'visual_supports'
  if (/\b(dictate|speech[- ]to[- ]text|voice note|record|choice of|two ways|alternative|oral|present|show (the )?learning)/i.test(text)) return 'alternative_demonstration'
  return 'simplified_text'
}

function toRequest(input: LensForStudentInput, teacher: string) {
  const { profile, analysis } = input
  return {
    task: 'lesson-lens',
    teacher,
    subject: input.subject,
    lesson: analysis.objectives[0] ?? input.subject,
    details: (input.lessonText ?? analysis.objectives.join('\n')).slice(0, 4000),
    students: [
      {
        key: profile.studentToken,
        goals: profile.goals.map((g) => ({ id: g.goalId, area: g.area, text: g.text, level: g.objective ? `${g.objective.target} ${g.objective.unit}` : '' })),
        accommodations: [...profile.accommodations, ...profile.supports],
        strengths: profile.strengths,
      },
    ],
  }
}

function toOutput(raw: string, input: LensForStudentInput): LensForStudentOutput {
  const reply = Reply.parse(JSON.parse(raw))
  const key = input.profile.studentToken
  const goalIds = new Set(input.profile.goals.map((g) => g.goalId))
  const mine = (x: { studentKey: string; goalId: string }) => x.studentKey === key && goalIds.has(x.goalId)
  const adaptations = reply.suggestions.flatMap((raw) => {
    const r = Suggestion.safeParse(raw)
    if (!r.success || !mine(r.data)) return []
    const s = r.data
    const modify = s.kind === 'modification'
    const adaptationType = adaptationTypeFor(s.text, modify)
    return [{ adaptationType, title: TITLES[adaptationType], text: s.text, why: s.why, goalIds: [s.goalId], changesOutcome: modify, modelLabel: s.kind }]
  })
  if (!adaptations.length) throw new AgentError('empty')
  const gaps = (reply.gaps ?? []).flatMap((raw) => {
    const r = Gap.safeParse(raw)
    if (!r.success || !mine(r.data)) return []
    return [{ gapType: GAP_TYPES[r.data.type], title: r.data.text, why: '', goalIds: [r.data.goalId], accommodation: null }]
  })
  return AI_SCHEMAS.lensForStudent.output.parse({ gaps, adaptations, checks: [] })
}

export function withMaritime(base: AiProvider, cfg: MaritimeConfig): AiProvider {
  const lensForStudent = async (input: LensForStudentInput): Promise<LensForStudentOutput> => {
    try {
      return toOutput(await chat(cfg, toRequest(input, cfg.teacher)), input)
    } catch (err) {
      console.warn(`[maritime] lesson-lens fell back: ${err instanceof AgentError ? err.message : (err as Error)?.name}`)
      return base.lensForStudent(input)
    }
  }
  return Object.assign(Object.create(base) as AiProvider, { lensForStudent })
}
