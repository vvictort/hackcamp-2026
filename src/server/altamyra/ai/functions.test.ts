import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, AnalyseLessonOutput, DraftProgressOutput } from '../contract/ai'
import { AltamyraError } from '../contract/errors'
import { CBIEP_SAMPLE_TEXT, STUDENT_FIXTURES, type StudentFixture } from '../fixtures'
import { collectStrings, findIdentifiers } from './deidentify'
import { AiDeidentificationError, AiOutputError, VERTEX_NOT_CONFIGURED } from './errors'
import { FIXTURE_EXTRA_IDENTIFIERS, FIXTURE_LESSONS, fixtureRoster, tokenFor } from './fixture-data'
import { analyseLessonOnce, createAi, type AiCall, type LessonAnalysisCache } from './functions'
import { toAiProfile } from './profile'
import { createFixtureProvider } from './providers/fixture'
import { createVertexProvider } from './providers/vertex'
import { fixtureNamesIn, recordingProvider } from './test-helpers'

const roster = fixtureRoster()
const LESSONS = Object.values(FIXTURE_LESSONS)
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

const profileOf = (f: StudentFixture) => toAiProfile({ token: tokenFor(f.studentId), iep: f.iep, goals: f.goals, objectives: f.objectives })
const firstName = (f: StudentFixture) => f.iep.sections.student.firstName

/** Runs every AI function over all fixture students and lessons, with names and identifiers planted in free text. */
async function runEverything(ai: ReturnType<typeof createAi>) {
  const extra = (f: StudentFixture) => FIXTURE_EXTRA_IDENTIFIERS[f.key]
  await ai.proposeObjectives({ studentToken: 'S-K7Q4', goalId: 'g-import', area: 'Reading', goalText: CBIEP_SAMPLE_TEXT })

  const analyses: Record<string, AnalyseLessonOutput> = {}
  for (const lesson of LESSONS) analyses[lesson.lessonId] = await ai.analyseLesson(lesson)

  for (const f of STUDENT_FIXTURES) {
    const token = tokenFor(f.studentId)
    for (const g of f.goals) {
      await ai.proposeObjectives({
        studentToken: token,
        goalId: g.id,
        area: g.area,
        goalText: `${firstName(f)} ${f.iep.sections.student.lastName} (PEN: ${extra(f).studentNumber}, DOB ${extra(f).dateOfBirth}) will: ${g.text}`,
      })
    }
    const profile = profileOf(f)
    profile.strengths = [...profile.strengths, `${firstName(f)} helps Priya Sandhu hand out supplies`]
    for (const lesson of LESSONS) {
      const lens = await ai.lensForStudent({
        lessonId: lesson.lessonId,
        subject: lesson.subject,
        analysis: analyses[lesson.lessonId],
        lessonText: `${lesson.text}\nEmail questions to marcus.tran@sd99.fictional.example. ${firstName(f)} sits with Amara.`,
        profile,
        whatWorks: [{ adaptationType: 'visual_supports', n: 6, meanOutcome: 72 }],
      })
      for (const [i, check] of lens.checks.entries()) {
        await ai.scorePhotoPage({
          image: { fileKey: `captures/batch-1/page-${i}.jpg`, contentType: 'image/jpeg', bytesBase64: 'AAAA' },
          check: { checkId: `chk-${i}`, items: check.items, answerKey: check.answerKey, rubric: check.rubric },
        })
      }
    }
    await ai.parseVoiceNote({
      audio: { fileKey: 'voice/note-1.webm', contentType: 'audio/webm' },
      studentToken: token,
      objectives: f.objectives.map((o) => ({ objectiveId: o.id, metricType: o.metricType, description: `${firstName(f)}: ${o.masteryRule}` })),
    })
    for (const g of f.goals) {
      const o = f.objectives.find((x) => x.goalId === g.id)
      const points = f.dataPoints.filter((p) => p.objectiveId === o?.id && p.status !== 'pending_review')
      const draft: DraftProgressOutput = await ai.draftProgress({
        studentToken: token,
        period: '2026-27 Term 1',
        goal: { goalId: g.id, area: g.area, text: `${firstName(f)} will ${g.text}` },
        objective: o ? { metricType: o.metricType, unit: o.unit, target: o.target } : null,
        dataPoints: points.map((p) => ({ id: p.id, value: p.value, unit: p.unit, recordedAt: p.recordedAt, source: p.source })),
        proficiencySuggestion: null,
      })
      for (const language of ['en', 'fr', 'pa']) {
        await ai.summariseForFamily({ studentToken: token, language, draft })
      }
    }
  }
}

describe('de-identification scan over every AI function', () => {
  const logs: string[] = []
  beforeEach(() => {
    logs.length = 0
    for (const m of CONSOLE_METHODS) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')))
  })
  afterEach(() => vi.restoreAllMocks())

  it('no fixture name or identifier reaches a provider request or the console', async () => {
    const { provider, requests } = recordingProvider(createFixtureProvider())
    const hooked: AiCall[] = []
    const ai = createAi({ provider, roster, onCall: (c) => hooked.push(c) })
    await runEverything(ai)

    const fns = new Set(requests.map((r) => r.fn))
    expect([...fns].sort()).toEqual(
      ['analyseLesson', 'draftProgress', 'lensForStudent', 'parseVoiceNote', 'proposeObjectives', 'scorePhotoPage', 'summariseForFamily'],
    )
    expect(hooked.length).toBe(requests.length)
    for (const { fn, payload } of requests) {
      for (const s of collectStrings(payload)) {
        expect(fixtureNamesIn(s), `${fn}: ${s}`).toEqual([])
        expect(findIdentifiers(s, roster), `${fn}: ${s}`).toEqual([])
      }
      const json = JSON.stringify(payload)
      for (const id of Object.values(FIXTURE_EXTRA_IDENTIFIERS).flatMap((e) => Object.values(e))) expect(json).not.toContain(id)
    }
    const logText = logs.join('\n')
    expect(fixtureNamesIn(logText)).toEqual([])
    expect(findIdentifiers(logText, roster)).toEqual([])
  })

  it('refuses a call when an identifier cannot be removed, before the provider is reached', async () => {
    const { provider, requests } = recordingProvider(createFixtureProvider())
    const ai = createAi({ provider, roster })
    const check = { checkId: 'c', items: [{ id: 'q1', prompt: 'p', format: 'numeric' as const, options: null }], answerKey: [{ itemId: 'q1', accepted: ['1'] }], rubric: null }
    await expect(
      ai.scorePhotoPage({ image: { fileKey: 'photos/kai-nakamura.jpg', contentType: 'image/jpeg' }, check }),
    ).rejects.toBeInstanceOf(AiDeidentificationError)
    expect(requests).toEqual([])
    expect(ai.calls.scorePhotoPage).toBe(0)
  })

  it('fails closed when the input names a student who is not on the roster', async () => {
    const { provider, requests } = recordingProvider(createFixtureProvider())
    const ai = createAi({ provider, roster })
    const err = await ai
      .proposeObjectives({ studentToken: 'S-ZZZZ', goalId: 'g1', area: 'Reading', goalText: 'Retell the main idea' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiDeidentificationError)
    expect((err as AiDeidentificationError).kinds).toEqual(['unrostered_student'])
    expect(requests).toEqual([])
  })
})

describe('createAi', () => {
  it('re-identifies output so callers see real names', async () => {
    const ai = createAi({ provider: createFixtureProvider(), roster })
    const kai = STUDENT_FIXTURES[0]
    const points = kai.dataPoints.filter((p) => p.status !== 'pending_review' && p.objectiveId === kai.objectives[1].id)
    const out = await ai.draftProgress({
      studentToken: 'S-K7Q4',
      period: 'Term 1',
      goal: { goalId: kai.goals[1].id, area: kai.goals[1].area, text: kai.goals[1].text },
      objective: { metricType: 'frequency', unit: 'break card uses per day', target: 4 },
      dataPoints: points.map((p) => ({ id: p.id, value: p.value, unit: p.unit, recordedAt: p.recordedAt, source: p.source })),
      proficiencySuggestion: null,
    })
    expect(out.sentences[0].text.startsWith('Kai has been working')).toBe(true)
    expect(out.sentences.every((s) => !s.text.includes('S-K7Q4'))).toBe(true)
  })

  it('rejects provider output that fails the schema', async () => {
    const bad = { ...createFixtureProvider(), analyseLesson: async () => ({ objectives: 'nope' }) } as unknown as AiProvider
    const ai = createAi({ provider: bad, roster })
    await expect(ai.analyseLesson(FIXTURE_LESSONS.science)).rejects.toBeInstanceOf(AiOutputError)
  })

  it('rejects a lens check without key or rubric, and more than 3 checks', async () => {
    const real = createFixtureProvider()
    const tooMany = {
      ...real,
      lensForStudent: async (i: Parameters<AiProvider['lensForStudent']>[0]) => {
        const out = await real.lensForStudent(i)
        return { ...out, checks: [...out.checks, ...out.checks, ...out.checks, ...out.checks] }
      },
    }
    const sofia = STUDENT_FIXTURES[2]
    const analysis = await real.analyseLesson(FIXTURE_LESSONS.numeracy)
    const input = { lessonId: 'l', subject: 'math', analysis, lessonText: null, profile: profileOf(sofia), whatWorks: [] }
    await expect(createAi({ provider: tooMany, roster }).lensForStudent(input)).rejects.toBeInstanceOf(AiOutputError)
  })

  it('rejects invalid input with bad_request', async () => {
    const ai = createAi({ provider: createFixtureProvider(), roster })
    const err = await ai.summariseForFamily({ studentToken: '', language: 'en', draft: { sentences: [] } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AltamyraError)
    expect((err as AltamyraError).status).toBe(400)
  })

  it('surfaces the vertex "not configured" error', async () => {
    const ai = createAi({ provider: createVertexProvider(), roster })
    await expect(ai.analyseLesson(FIXTURE_LESSONS.literacy)).rejects.toThrow(VERTEX_NOT_CONFIGURED)
  })
})

describe('PRD 1A-2: one analysis call per lesson', () => {
  it('analyses a lesson once for every student in the class', async () => {
    const ai = createAi({ provider: createFixtureProvider(), roster })
    const store = new Map<string, AnalyseLessonOutput>()
    const cache: LessonAnalysisCache = { get: (id) => store.get(id), set: (id, a) => void store.set(id, a) }

    const lesson = FIXTURE_LESSONS.literacy
    const results = []
    for (const f of STUDENT_FIXTURES) {
      const analysis = await analyseLessonOnce(ai, lesson, cache)
      results.push(analysis)
      await ai.lensForStudent({ lessonId: lesson.lessonId, subject: lesson.subject, analysis, lessonText: lesson.text, profile: profileOf(f), whatWorks: [] })
    }
    expect(ai.calls.analyseLesson).toBe(1)
    expect(ai.calls.lensForStudent).toBe(STUDENT_FIXTURES.length)
    expect(results[1]).toBe(results[0])

    await analyseLessonOnce(ai, FIXTURE_LESSONS.numeracy, cache)
    expect(ai.calls.analyseLesson).toBe(2)
  })
})
