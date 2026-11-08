import { describe, expect, it } from 'vitest'
import type { AnalyseLessonOutput } from '../contract/ai'
import { ADAPTATION_TYPES, LABELS } from '../contract/enums'
import { STUDENT_FIXTURES } from '../fixtures'
import { FIXTURE_LESSONS, tokenFor } from './fixture-data'
import { classifyAdaptation, type GuardrailAdaptation } from './guardrail'
import { toAiProfile } from './profile'
import { createFixtureProvider } from './providers/fixture'

const analysis = { objectives: ['I can add two-digit numbers with regrouping and explain my strategy.'] }
const authorized = { modificationSubjects: ['math'] }
const none = { modificationSubjects: [] as string[] }

const base = (o: Partial<GuardrailAdaptation> = {}): GuardrailAdaptation => ({
  adaptationType: 'chunked_steps',
  text: 'Give one step per card with base-ten blocks.',
  changesOutcome: false,
  modelLabel: 'adaptation',
  subject: 'math',
  ...o,
})

describe('classifyAdaptation (PRD 1A-5)', () => {
  it('is exhaustive over type x changesOutcome x model label x authorization', () => {
    for (const adaptationType of ADAPTATION_TYPES) {
      for (const changesOutcome of [false, true]) {
        for (const modelLabel of [...LABELS, null]) {
          for (const iep of [authorized, none]) {
            const r = classifyAdaptation(base({ adaptationType, changesOutcome, modelLabel }), analysis, iep)
            const expected = changesOutcome || adaptationType === 'modified_assessment' ? 'modification' : 'adaptation'
            const ctx = `${adaptationType} ${changesOutcome} ${modelLabel} ${iep.modificationSubjects}`
            expect(r.label, ctx).toBe(expected)
            expect(r.status, ctx).toBe(expected === 'modification' && iep === none ? 'blocked' : 'draft')
            expect(r.modelLabelOverridden, ctx).toBe(modelLabel !== null && modelLabel !== expected)
          }
        }
      }
    }
  })

  it('never trusts a model label of "modification" on an unchanged outcome', () => {
    const r = classifyAdaptation(base({ modelLabel: 'modification' }), analysis, none)
    expect(r).toEqual({ label: 'adaptation', status: 'draft', reasons: [], modelLabelOverridden: true })
  })

  it('detects outcome changes in the text even when the model says none', () => {
    const cases = [
      'Let the student add single-digit numbers only, in place of two-digit numbers with regrouping.',
      'Skip the regrouping problems with two-digit numbers.',
      'Use a lower grade-level outcome for this practice set.',
      'Modify the learning outcome to counting to 20.',
      'Assess counting instead of the grade-level outcome.',
    ]
    for (const text of cases) {
      const r = classifyAdaptation(base({ text }), analysis, none)
      expect(r.label, text).toBe('modification')
      expect(r.status, text).toBe('blocked')
    }
  })

  it('keeps a different way to show the same learning as an adaptation', () => {
    const cases = [
      'Instead of writing, the student explains the regrouping strategy out loud.',
      'Rather than a worksheet, use base-ten blocks; same problems.',
      'Remove distractions: one problem per page.',
    ]
    for (const text of cases) expect(classifyAdaptation(base({ text }), analysis, none).label, text).toBe('adaptation')
  })

  it('authorizes only the IEP subject, case-insensitively', () => {
    const mod = base({ changesOutcome: true })
    expect(classifyAdaptation(mod, analysis, { modificationSubjects: ['Math'] }).status).toBe('draft')
    expect(classifyAdaptation({ ...mod, subject: 'literacy' }, analysis, authorized).status).toBe('blocked')
  })

  it('labels 100% of outcome-changing fixture adaptations as modification', async () => {
    const p = createFixtureProvider()
    let outcomeChanging = 0
    for (const lesson of Object.values(FIXTURE_LESSONS)) {
      const a: AnalyseLessonOutput = await p.analyseLesson(lesson)
      for (const f of STUDENT_FIXTURES) {
        const profile = toAiProfile({ token: tokenFor(f.studentId), iep: f.iep, goals: f.goals, objectives: f.objectives })
        const lens = await p.lensForStudent({ lessonId: lesson.lessonId, subject: lesson.subject, analysis: a, lessonText: lesson.text, profile, whatWorks: [] })
        for (const ad of lens.adaptations) {
          const r = classifyAdaptation({ ...ad, subject: lesson.subject }, a, f.iep)
          if (ad.changesOutcome || ad.adaptationType === 'modified_assessment') {
            outcomeChanging++
            expect(r.label).toBe('modification')
            expect(r.status).toBe(f.iep.modificationSubjects.includes(lesson.subject) ? 'draft' : 'blocked')
          }
        }
      }
    }
    // Kai's mislabelled math suggestion and Sofía's authorized math modification.
    expect(outcomeChanging).toBeGreaterThanOrEqual(2)
  })
})
