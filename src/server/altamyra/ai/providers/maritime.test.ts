import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_SCHEMAS, type LensForStudentInput } from '../../contract/ai'
import { STUDENT_FIXTURES } from '../../fixtures'
import { FIXTURE_LESSONS, fixtureProfile, tokenFor } from '../fixture-data'
import { getProvider } from '../provider'
import { createFixtureProvider } from './fixture'
import { withMaritime } from './maritime'

const base = createFixtureProvider()
const f = STUDENT_FIXTURES[0]
const lesson = FIXTURE_LESSONS.literacy

async function lensInput(): Promise<LensForStudentInput> {
  return {
    lessonId: lesson.lessonId,
    subject: lesson.subject,
    analysis: await base.analyseLesson(lesson),
    lessonText: lesson.text,
    profile: fixtureProfile(f),
    whatWorks: [],
  }
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function agent(fetchImpl: typeof fetch, timeoutMs?: number) {
  return withMaritime(base, { url: 'https://agent.test/', token: 'mk_test', teacher: 'abc123', fetch: fetchImpl, timeoutMs })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('withMaritime', () => {
  it('sends the de-identified lesson-lens task and maps the reply to the lens contract', async () => {
    const input = await lensInput()
    const key = input.profile.studentToken
    const goalId = input.profile.goals[0].goalId
    const fetchMock = vi.fn(async () =>
      reply({
        response: JSON.stringify({
          suggestions: [
            { studentKey: key, goalId, kind: 'adaptation', text: 'Give a picture card for each new word.', why: 'Supports the reading goal.' },
            { studentKey: key, goalId, kind: 'modification', text: 'Set an individual target.', why: 'The goal is modified.' },
            { studentKey: 'Student Z', goalId, kind: 'adaptation', text: 'Not this student.', why: 'x' },
            { studentKey: key, goalId: 'unknown', kind: 'adaptation', text: 'Unknown goal.', why: 'x' },
          ],
          gaps: [
            { studentKey: key, goalId, type: 'skill', text: 'May get stuck decoding.' },
            { studentKey: key, goalId, type: 'nonsense', text: 'Dropped.' },
          ],
          source: 'gemini',
        }),
      }),
    )
    const out = await agent(fetchMock as unknown as typeof fetch).lensForStudent(input)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://agent.test/chat')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer mk_test')
    const message = JSON.parse(JSON.parse(init.body as string).message)
    expect(message).toMatchObject({ task: 'lesson-lens', teacher: 'abc123', subject: lesson.subject, students: [{ key }] })
    expect(message.students[0].goals[0]).toMatchObject({ id: goalId, area: input.profile.goals[0].area, text: input.profile.goals[0].text })

    expect(AI_SCHEMAS.lensForStudent.output.safeParse(out).success).toBe(true)
    expect(out.adaptations).toEqual([
      expect.objectContaining({ adaptationType: 'visual_supports', title: 'Visual supports', goalIds: [goalId], changesOutcome: false, modelLabel: 'adaptation' }),
      expect.objectContaining({ adaptationType: 'modified_assessment', goalIds: [goalId], changesOutcome: true, modelLabel: 'modification' }),
    ])
    expect(out.gaps).toEqual([{ gapType: 'goal', title: 'May get stuck decoding.', why: '', goalIds: [goalId], accommodation: null }])
    expect(out.checks).toEqual([])
  })

  it.each([
    ['a non-2xx status', async () => reply({ error: 'unauthorized' }, 401)],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed'))],
    ['an unparseable reply', async () => reply({ response: 'not json' })],
    ['a reply without suggestions', async () => reply({ response: JSON.stringify({ nope: 1 }) })],
    ['no usable suggestion', async () => reply({ response: JSON.stringify({ suggestions: [{ studentKey: 'x' }] }) })],
  ])('falls back to the base provider on %s', async (_, impl) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const input = await lensInput()
    const out = await agent(vi.fn(impl) as unknown as typeof fetch).lensForStudent(input)
    expect(out).toEqual(await base.lensForStudent(input))
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).not.toContain(input.profile.goals[0].text)
  })

  it('falls back when the agent does not answer in time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch
    const input = await lensInput()
    expect(await agent(hang, 20).lensForStudent(input)).toEqual(await base.lensForStudent(input))
  })

  it('delegates every other function to the base provider', async () => {
    const fetchMock = vi.fn()
    const p = agent(fetchMock as unknown as typeof fetch)
    expect(p.name).toBe(base.name)
    expect(await p.analyseLesson(lesson)).toEqual(await base.analyseLesson(lesson))
    const goal = { studentToken: 'S-X', goalId: 'g', area: 'Math', goalText: 'Add to 20' }
    expect(await p.proposeObjectives(goal)).toEqual(await base.proposeObjectives(goal))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getProvider with Maritime', () => {
  const lensCallsAgent = async (env: Parameters<typeof getProvider>[0]) => {
    const fetchMock = vi.fn(async () => reply({ error: 'down' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await getProvider(env).lensForStudent(await lensInput())
    return fetchMock.mock.calls.length > 0
  }

  it('wraps the provider only when both MARITIME_AGENT_URL and MARITIME_AGENT_TOKEN are set', async () => {
    expect(await lensCallsAgent({ MARITIME_AGENT_URL: 'https://agent.test', MARITIME_AGENT_TOKEN: 'mk_test' })).toBe(true)
    expect(await lensCallsAgent({ MARITIME_AGENT_URL: 'https://agent.test' })).toBe(false)
    expect(await lensCallsAgent({ MARITIME_AGENT_TOKEN: 'mk_test' })).toBe(false)
    expect(await lensCallsAgent({ MARITIME_AGENT_URL: ' ', MARITIME_AGENT_TOKEN: 'mk_test' })).toBe(false)
  })

  it('never wraps a provider forced to the fixture', async () => {
    expect(await lensCallsAgent({ ALTAMYRA_AI_PROVIDER: 'fixture', MARITIME_AGENT_URL: 'https://agent.test', MARITIME_AGENT_TOKEN: 'mk_test' })).toBe(false)
  })
})
