import { describe, expect, it } from 'vitest'
import { AI_SCHEMAS, type AnalyseLessonOutput, type LensForStudentInput } from '../contract/ai'
import { STUDENT_FIXTURES } from '../fixtures'
import { VERTEX_NOT_CONFIGURED } from './errors'
import { FIXTURE_LESSONS, tokenFor } from './fixture-data'
import { getProvider } from './provider'
import { toAiProfile } from './profile'
import { createFixtureProvider } from './providers/fixture'
import { createVertexProvider } from './providers/vertex'

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
        profile: toAiProfile({ token: tokenFor(f.studentId), iep: f.iep, goals: f.goals, objectives: f.objectives }),
        whatWorks: [],
      })
    }
  }
  return out
}

describe('getProvider', () => {
  it('defaults to fixture', () => {
    expect(getProvider().name).toBe('fixture')
    expect(getProvider({}).name).toBe('fixture')
    expect(getProvider({ ALTAMYRA_AI_PROVIDER: '' }).name).toBe('fixture')
    expect(getProvider({ ALTAMYRA_AI_PROVIDER: 'fixture' }).name).toBe('fixture')
  })
  it('selects vertex', () => {
    expect(getProvider({ ALTAMYRA_AI_PROVIDER: 'vertex' }).name).toBe('vertex')
    expect(getProvider({ ALTAMYRA_AI_PROVIDER: ' Vertex ' }).name).toBe('vertex')
  })
  it('selects gemini when GEMINI_API_KEY is set, fixture when not', () => {
    expect(getProvider({ GEMINI_API_KEY: 'k' }).name).toBe('gemini')
    expect(getProvider({ GEMINI_API_KEY: '  ' }).name).toBe('fixture')
    expect(getProvider({ ALTAMYRA_AI_PROVIDER: 'fixture', GEMINI_API_KEY: 'k' }).name).toBe('fixture')
    expect(getProvider({ ALTAMYRA_AI_PROVIDER: 'vertex', GEMINI_API_KEY: 'k' }).name).toBe('vertex')
  })
  it('refuses an unknown provider', () => {
    expect(() => getProvider({ ALTAMYRA_AI_PROVIDER: 'openai' })).toThrow(/Unknown ALTAMYRA_AI_PROVIDER/)
  })
})

describe('vertex stub', () => {
  it('throws the not-configured error from every function', async () => {
    const v = createVertexProvider()
    for (const fn of Object.keys(AI_SCHEMAS) as (keyof typeof AI_SCHEMAS)[]) {
      await expect((v[fn] as (i: unknown) => Promise<unknown>)({})).rejects.toThrow(VERTEX_NOT_CONFIGURED)
    }
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

  it('scores photo pages, voice notes, drafts and summaries into valid outputs', async () => {
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

    const draft = AI_SCHEMAS.draftProgress.output.parse(
      await fixture.draftProgress({
        studentToken: 'S-X',
        period: 'T1',
        goal: { goalId: 'g', area: 'Math', text: 'Add to 20' },
        objective: { metricType: 'accuracy', unit: '% correct', target: 80 },
        dataPoints: [
          { id: 'p2', value: 70, unit: '% correct', recordedAt: '2026-10-14T00:00:00Z', source: 'student' },
          { id: 'p1', value: 60, unit: '% correct', recordedAt: '2026-10-07T00:00:00Z', source: 'photo' },
        ],
        proficiencySuggestion: null,
      }),
    )
    expect(draft.sentences[1].text).toBe('Results grew from 60 % correct to 70 % correct.')
    expect(draft.sentences.flatMap((s) => s.citations).every((id) => ['p1', 'p2'].includes(id))).toBe(true)

    const empty = await fixture.draftProgress({ studentToken: 'S-X', period: 'T1', goal: { goalId: 'g', area: 'a', text: 't' }, objective: null, dataPoints: [], proficiencySuggestion: null })
    expect(empty.sentences).toEqual([])

    const fr = await fixture.summariseForFamily({ studentToken: 'S-X', language: 'fr', draft })
    expect(fr.language).toBe('fr')
    const pa = await fixture.summariseForFamily({ studentToken: 'S-X', language: 'pa', draft })
    expect(pa.language).toBe('en')
    expect(AI_SCHEMAS.summariseForFamily.output.safeParse(pa).success).toBe(true)
  })
})
