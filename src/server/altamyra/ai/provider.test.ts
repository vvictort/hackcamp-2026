import { describe, expect, it, vi } from 'vitest'
import { AI_SCHEMAS, type AnalyseLessonOutput, type LensForStudentInput } from '../contract/ai'
import { STUDENT_FIXTURES } from '../fixtures'
import { FIXTURE_LESSONS, fixtureProfile, tokenFor } from './fixture-data'
import { getProvider } from './provider'
import { createFixtureProvider } from './providers/fixture'

const fixture = createFixtureProvider()
const LESSONS = Object.values(FIXTURE_LESSONS)

async function lensInputs(): Promise<LensForStudentInput[]> {
  const out: LensForStudentInput[] = []
  for (const lesson of LESSONS) {
    const analysis: AnalyseLessonOutput = await fixture.analyseLesson(lesson)
    for (const f of STUDENT_FIXTURES) {
      out.push({
        lessonId: lesson.lessonId,
        subject: lesson.subject,
        analysis,
        lessonText: lesson.text,
        profile: fixtureProfile(f),
        whatWorks: [],
      })
    }
  }
  return out
}

describe('getProvider', () => {
  const callsGemini = async (env: Parameters<typeof getProvider>[0]) => {
    const f = vi.fn(async () => new Response('x', { status: 404 }))
    vi.stubGlobal('fetch', f)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await getProvider(env).proposeObjectives({ studentToken: 'S-X', goalId: 'g1', area: 'Reading', goalText: 'Retell a story' })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    return f.mock.calls.length > 0
  }
  it('selects gemini when GEMINI_API_KEY is set, the fixture when not', async () => {
    expect(await callsGemini(undefined)).toBe(false)
    expect(await callsGemini({ GEMINI_API_KEY: '  ' })).toBe(false)
    expect(await callsGemini({ GEMINI_API_KEY: 'k' })).toBe(true)
  })
})

describe('fixture provider', () => {
  it('analyses every fixture lesson into a valid, plausible analysis', async () => {
    for (const lesson of LESSONS) {
      const a = AI_SCHEMAS.analyseLesson.output.parse(await fixture.analyseLesson(lesson))
      expect(a.objectives.length).toBeGreaterThan(0)
      expect(a.competencies.length).toBeGreaterThan(0)
    }
    const lit = await fixture.analyseLesson(FIXTURE_LESSONS.literacy)
    expect(lit.objectives[0]).toMatch(/main idea/)
    expect(lit.writingLoad).not.toBe('low')
  })

  it('is deterministic: the same input gives the same output', async () => {
    for (const input of await lensInputs()) {
      expect(await fixture.lensForStudent(input)).toEqual(await fixture.lensForStudent(structuredClone(input)))
    }
  })

  it('lens output is schema-valid and follows PRD 1A-3, 1A-4, 1A-6', async () => {
    for (const input of await lensInputs()) {
      const out = AI_SCHEMAS.lensForStudent.output.parse(await fixture.lensForStudent(input))
      // 1A-3: every gap names a goal or an accommodation.
      for (const g of out.gaps) expect(g.goalIds.length > 0 || g.accommodation !== null).toBe(true)
      // 1A-4: every adaptation is tagged to at least one of this student's goals.
      const goalIds = new Set(input.profile.goals.map((g) => g.goalId))
      for (const a of out.adaptations) expect(a.goalIds.every((id) => goalIds.has(id))).toBe(true)
      // 1A-6: 1 to 3 checks when the student has a confirmed accuracy objective, tied to it.
      const scorable = input.profile.goals.filter((g) => g.objective && ['accuracy', 'rubric'].includes(g.objective.metricType))
      expect(out.checks.length).toBe(Math.min(3, scorable.length))
      for (const c of out.checks) expect(scorable.some((g) => g.objective?.objectiveId === c.objectiveId)).toBe(true)
    }
  })

  it('gives Amara (no confirmed objective) no checks', async () => {
    const amara = (await lensInputs()).find((i) => i.profile.studentToken === 'S-A2M9')!
    expect((await fixture.lensForStudent(amara)).checks).toEqual([])
  })

  it('orders adaptations by what worked for the student (PRD 1A-9)', async () => {
    const kai = (await lensInputs()).find((i) => i.profile.studentToken === 'S-K7Q4' && i.subject === 'literacy')!
    const plain = await fixture.lensForStudent(kai)
    expect(plain.adaptations[0].adaptationType).toBe('simplified_text')
    const ranked = await fixture.lensForStudent({ ...kai, whatWorks: [{ adaptationType: 'visual_supports', n: 8, meanOutcome: 85 }] })
    expect(ranked.adaptations[0].adaptationType).toBe('visual_supports')
  })

  it('proposes objectives for every fixture goal and flags an unmeasurable one', async () => {
    for (const f of STUDENT_FIXTURES) {
      for (const g of f.goals) {
        const out = AI_SCHEMAS.proposeObjectives.output.parse(
          await fixture.proposeObjectives({ studentToken: 'S-X', goalId: g.id, area: g.area, goalText: g.text }),
        )
        expect(out.measurable, g.text).toBe(true)
      }
    }
    const vague = await fixture.proposeObjectives({ studentToken: 'S-X', goalId: 'g', area: 'Wellbeing', goalText: 'Feel happier at school' })
    expect(vague.measurable).toBe(false)
  })

  it('scores photo pages and voice notes into valid outputs', async () => {
    const photo = await fixture.scorePhotoPage({
      image: { fileKey: 'captures/b1/sheet-code-K7Q4-L1.jpg', contentType: 'image/jpeg' },
      check: { checkId: 'c', items: [{ id: 'q1', prompt: '3 + 4?', format: 'numeric', options: null }], answerKey: [{ itemId: 'q1', accepted: ['7'] }], rubric: null },
    })
    expect(AI_SCHEMAS.scorePhotoPage.output.parse(photo).sheetCode).toBe('K7Q4-L1')
    expect([0, 1]).toContain(photo.items[0].value)

    const voice = AI_SCHEMAS.parseVoiceNote.output.parse(
      await fixture.parseVoiceNote({
        audio: { fileKey: 'v.webm', contentType: 'audio/webm' },
        studentToken: 'S-X',
        objectives: [
          { objectiveId: 'o1', metricType: 'prompt_level', description: 'writing' },
          { objectiveId: 'o2', metricType: 'frequency', description: 'break card' },
          { objectiveId: 'o3', metricType: 'duration', description: 'on task' },
        ],
      }),
    )
    expect(voice.events.map((e) => e.kind)).toEqual(['prompt_level', 'counter', 'timer'])
  })
})
