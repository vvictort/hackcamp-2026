import { describe, expect, it } from 'vitest'
import { AI_SCHEMAS, LensForStudentOutput, ProposeObjectivesOutput } from './ai'
import { CaptureEventBody, IepImportBody, InsightsQuery, StudentProfileResponse } from './api'
import { AltamyraError, ERROR_STATUS, ErrorBody } from './errors'
import { PROMPT_LEVELS, promptLevelFromValue, promptLevelValue } from './enums'
import { AdaptationSuggestion, Suggestion } from './student'

describe('AI contracts', () => {
  it('cover all five AI functions', () => {
    expect(Object.keys(AI_SCHEMAS).sort()).toEqual(['analyseLesson', 'lensForStudent', 'parseVoiceNote', 'proposeObjectives', 'scorePhotoPage'])
  })

  it('proposeObjectives can say a goal is unmeasurable', () => {
    expect(ProposeObjectivesOutput.parse({ measurable: false, goalId: 'g', reason: 'no observable behaviour' }).measurable).toBe(false)
  })

  it('lens output: adaptations need a goal, at most 3 checks, each with a key or rubric', () => {
    const adaptation = {
      adaptationType: 'chunked_steps',
      title: 'Steps',
      text: 'Three steps',
      why: 'Goal',
      goalIds: ['g1'],
      changesOutcome: false,
      modelLabel: 'adaptation',
    }
    const check = { goalId: 'g1', objectiveId: 'o1', items: [{ id: 'i1', prompt: '2+3', format: 'numeric', options: null }], answerKey: [{ itemId: 'i1', accepted: ['5'] }], rubric: null }
    expect(LensForStudentOutput.safeParse({ gaps: [], adaptations: [adaptation], checks: [check] }).success).toBe(true)
    expect(LensForStudentOutput.safeParse({ gaps: [], adaptations: [{ ...adaptation, goalIds: [] }], checks: [] }).success).toBe(false)
    expect(LensForStudentOutput.safeParse({ gaps: [], adaptations: [], checks: [check, check, check, check] }).success).toBe(false)
    expect(LensForStudentOutput.safeParse({ gaps: [], adaptations: [], checks: [{ ...check, answerKey: null }] }).success).toBe(false)
  })
})

describe('entity contracts', () => {
  it('suggestion union keeps gap and adaptation shapes apart', () => {
    const base = { id: 's', lensRunId: 'r', status: 'draft', createdAt: 't', version: 1 }
    const gap = { ...base, kind: 'gap', gapType: 'access', adaptationType: null, label: null, goalIds: [], content: { title: 'Reading load', why: 'w', accommodation: null } }
    expect(Suggestion.parse(gap).kind).toBe('gap')
    const adapt = {
      ...base,
      kind: 'adaptation',
      gapType: null,
      adaptationType: 'modified_assessment',
      label: 'modification',
      goalIds: [],
      content: { title: 't', text: 'x', why: 'w', subject: 'math', changesOutcome: true },
    }
    // PRD 1A-4: an adaptation without a goal is invalid.
    expect(AdaptationSuggestion.safeParse(adapt).success).toBe(false)
    expect(Suggestion.safeParse({ ...adapt, goalIds: ['g'] }).success).toBe(true)
  })

  it('prompt levels map to ordinal values both ways', () => {
    PROMPT_LEVELS.forEach((level, i) => {
      expect(promptLevelValue(level)).toBe(i)
      expect(promptLevelFromValue(i)).toBe(level)
    })
  })
})

describe('API contracts', () => {
  it('EA events are a tagged union', () => {
    expect(CaptureEventBody.parse({ kind: 'counter', objectiveId: 'o', count: 2 })).toMatchObject({ classId: null })
    expect(CaptureEventBody.safeParse({ kind: 'prompt_level', objectiveId: 'o', promptLevel: 'shout' }).success).toBe(false)
  })

  it('imports require the matching payload', () => {
    expect(IepImportBody.safeParse({ sourceKind: 'pdf' }).success).toBe(false)
    expect(IepImportBody.safeParse({ sourceKind: 'text', text: 'IEP' }).success).toBe(true)
  })

  it('the supports view carries no IEP sections', () => {
    const view = StudentProfileResponse.parse({ view: 'supports', id: 's', firstName: 'A', supports: [], accommodations: [] })
    expect('sections' in view).toBe(false)
  })

  it('insights default to grouping by goal area', () => {
    expect(InsightsQuery.parse({}).groupBy).toEqual(['goalArea'])
  })

  it('errors serialise to the shared body', () => {
    const err = new AltamyraError('version_conflict', 'stale')
    expect(ERROR_STATUS[err.code]).toBe(409)
    expect(ErrorBody.parse(err.toBody())).toEqual({ error: { code: 'version_conflict', message: 'stale' } })
  })
})
