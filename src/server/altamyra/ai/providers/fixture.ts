import type {
  AiProvider,
  AnalyseLessonInput,
  AnalyseLessonOutput,
  LensAdaptation,
  LensCheck,
  LensForStudentInput,
  LensForStudentOutput,
  LensGap,
  ParseVoiceNoteInput,
  ParseVoiceNoteOutput,
  ProposeObjectivesInput,
  ProposeObjectivesOutput,
  ScorePhotoPageInput,
  ScorePhotoPageOutput,
  VoiceEvent,
} from '../../contract/ai'
import { PROMPT_LEVELS, type AdaptationType } from '../../contract/enums'
import { hashOf, unitInterval } from '../hash'

/**
 * Deterministic provider (design doc: "fixture, default"). Every output is
 * derived from the input and a hash of it, so the same input always gives
 * the same output, and every output parses with the contract/ai.ts schemas.
 * It sees only de-identified input; text refers to the student by token.
 */

const pick = <T>(items: readonly T[], seed: number, salt = ''): T => items[Math.floor(unitInterval(seed, salt) * items.length)]
const round2 = (n: number) => Math.round(n * 100) / 100
const has = (text: string, re: RegExp) => re.test(text.toLowerCase())

// ---------- proposeObjectives ----------

function proposeObjectives(input: ProposeObjectivesInput): ProposeObjectivesOutput {
  const text = `${input.area} ${input.goalText}`.toLowerCase()
  const seed = hashOf(input)
  const base = { measurable: true as const, goalId: input.goalId }
  if (has(text, /\b(read|retell|comprehen|main idea)/)) {
    return {
      ...base,
      metricType: 'accuracy',
      unit: '% correct',
      baselineMethod: pick(['Median score on the first 3 embedded retell checks', 'Score on 3 short retell probes in the first two weeks'], seed),
      target: 80,
      masteryRule: '80% or higher on 3 consecutive embedded checks',
      captureMethod: 'photo',
    }
  }
  if (has(text, /\b(writ|sentences|paragraph)/)) {
    return {
      ...base,
      metricType: 'prompt_level',
      unit: 'prompt level',
      baselineMethod: 'Median prompt level over the first 3 writing tasks',
      target: PROMPT_LEVELS.indexOf('independent'),
      masteryRule: 'Independent on 3 of the last 4 writing tasks',
      captureMethod: 'ea',
    }
  }
  if (has(text, /\b(count|add|subtract|number|math|compare)/)) {
    return {
      ...base,
      metricType: 'accuracy',
      unit: '% correct',
      baselineMethod: 'Median score on the first 3 embedded math checks',
      target: 80,
      masteryRule: '80% or higher on 3 consecutive embedded checks',
      captureMethod: 'photo',
    }
  }
  if (has(text, /\b(minutes|stay|sustain|on task)/)) {
    return {
      ...base,
      metricType: 'duration',
      unit: 'minutes',
      baselineMethod: 'Median minutes on task across 3 observed work periods',
      target: 15,
      masteryRule: '15 minutes or more in 4 of 5 observed work periods',
      captureMethod: 'ea',
    }
  }
  if (has(text, /\b(ask|request|break|share|initiat|greet|use)/)) {
    return {
      ...base,
      metricType: 'frequency',
      unit: 'times per day',
      baselineMethod: 'Average count per day over the first 5 school days',
      target: 4,
      masteryRule: '4 or more independent occurrences per day for 2 weeks',
      captureMethod: 'ea',
    }
  }
  return {
    measurable: false,
    goalId: input.goalId,
    reason: 'The goal does not name an observable behaviour that can be counted, timed or scored. Ask the case manager to reword it.',
  }
}

// ---------- analyseLesson ----------

const COMPETENCIES: Record<string, string[]> = {
  literacy: [
    'Comprehend and connect: use a variety of comprehension strategies before, during and after reading',
    'Create and communicate: exchange ideas and perspectives to build shared understanding',
  ],
  math: [
    'Reasoning and analyzing: use reasoning to explore and make connections',
    'Understanding and solving: develop, demonstrate and apply mathematical understanding through concrete materials',
    'Communicating and representing: explain and justify mathematical ideas',
  ],
  science: [
    'Questioning and predicting: make predictions based on prior knowledge',
    'Planning and conducting: observe, measure and record data',
    'Processing and analyzing data: compare results with predictions',
  ],
}

function analyseLesson(input: AnalyseLessonInput): AnalyseLessonOutput {
  const text = input.text ?? ''
  const goals = [...text.matchAll(/learning goal:\s*(.+)/gi)].map((m) => m[1].trim())
  const objectives = goals.length > 0 ? goals : [`Work toward the grade ${input.grade} ${input.subject} outcomes in "${input.title}"`]

  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0)
  const words = text.split(/\s+/).filter(Boolean).length
  const perSentence = sentences.length > 0 ? words / sentences.length : 0
  const gradeNum = Number.parseInt(input.grade, 10) || 4
  const readingGrade = perSentence > 16 ? gradeNum + 1 : perSentence > 10 ? gradeNum : Math.max(1, gradeNum - 1)

  const writingCues = (text.match(/\b(write|writing|paragraph|explain in writing|record)\b/gi) ?? []).length
  const writingLoad = writingCues >= 2 ? 'high' : writingCues === 1 ? 'medium' : 'low'

  const modality: string[] = []
  if (text.length > 0 || input.file) modality.push('text')
  if (has(text, /diagram|picture|chart|number line|label/)) modality.push('visual')
  if (has(text, /blocks|cubes|experiment|build|plant/)) modality.push('hands-on')
  if (has(text, /discuss|partner|share|talk/)) modality.push('oral')

  return {
    objectives,
    readingLevel: `Grade ${readingGrade}`,
    writingLoad,
    modality,
    competencies: COMPETENCIES[input.subject] ?? [`Grade ${input.grade} ${input.subject} curricular competencies`],
  }
}

// ---------- lensForStudent ----------

type Profile = LensForStudentInput['profile']
type ProfileGoal = Profile['goals'][number]

function adaptationForGoal(goal: ProfileGoal, token: string): Omit<LensAdaptation, 'goalIds'> {
  const t = `${goal.area} ${goal.text}`.toLowerCase()
  const why = `Supports ${token}'s IEP goal: ${goal.text}.`
  if (has(t, /read|retell/)) {
    return {
      adaptationType: 'simplified_text',
      title: 'Simplified passage with the same key ideas',
      text: 'Rewrite the passage in short sentences at about two grade levels lower, keeping every key idea and vocabulary word. Add a three-box "beginning, middle, end" retell strip.',
      why,
      changesOutcome: false,
      modelLabel: 'adaptation',
    }
  }
  if (has(t, /writ/)) {
    return {
      adaptationType: 'sentence_frames',
      title: 'Planner and sentence frames',
      text: 'Give a one-idea planner and frames: "The main idea is ___." "One detail is ___." "This matters because ___." Speech-to-text is allowed for the draft.',
      why,
      changesOutcome: false,
      modelLabel: 'adaptation',
    }
  }
  if (has(t, /break|regulat|calm|overwhelm/)) {
    return {
      adaptationType: 'visual_supports',
      title: 'Visual task steps and break card on the desk',
      text: 'Show the lesson as 3 pictogram steps on a first-then strip and place the break card beside it. Point to the card before the longest task.',
      why,
      changesOutcome: false,
      modelLabel: 'adaptation',
    }
  }
  if (has(t, /communicat|share|talk|sentence/)) {
    return {
      adaptationType: 'sentence_frames',
      title: 'Sentence starters for partner talk',
      text: 'Give two sentence starters for the partner discussion: "I think ___ because ___." "I learned that ___." Let the peer buddy go first.',
      why,
      changesOutcome: false,
      modelLabel: 'adaptation',
    }
  }
  return {
    adaptationType: 'chunked_steps',
    title: 'Chunked steps with manipulatives',
    text: 'Break the task into one step per card and model each step with concrete materials before the student tries it.',
    why,
    changesOutcome: false,
    modelLabel: 'adaptation',
  }
}

function lensGaps(input: LensForStudentInput): LensGap[] {
  const { profile, analysis } = input
  const gaps: LensGap[] = []
  const firstGoal = profile.goals[0]?.goalId
  const accommodation = (re: RegExp) => profile.accommodations.find((a) => re.test(a.toLowerCase())) ?? null

  const writingAcc = accommodation(/speech-to-text|scribe|writing|extra time/)
  if (analysis.writingLoad !== 'low' && writingAcc) {
    gaps.push({
      gapType: 'accommodation',
      title: `Writing load is ${analysis.writingLoad}`,
      why: `The lesson asks for written output; the IEP lists "${writingAcc}".`,
      goalIds: [],
      accommodation: writingAcc,
    })
  }
  const visualAcc = accommodation(/visual|pictogram/)
  if (visualAcc && !analysis.modality.includes('visual')) {
    gaps.push({
      gapType: 'accommodation',
      title: 'No visual supports in the lesson',
      why: `The lesson is text only; the IEP lists "${visualAcc}".`,
      goalIds: [],
      accommodation: visualAcc,
    })
  }
  const stepAcc = accommodation(/one step at a time|fewer items|chunk/)
  if (stepAcc) {
    gaps.push({
      gapType: 'access',
      title: 'Several instructions given at once',
      why: `The lesson gives several instructions together; the IEP lists "${stepAcc}".`,
      goalIds: [],
      accommodation: stepAcc,
    })
  }
  for (const g of profile.goals) {
    gaps.push({
      gapType: 'goal',
      title: `No built-in practice for ${g.area.toLowerCase()}`,
      why: `The lesson does not yet give ${profile.studentToken} a chance to work on: ${g.text}.`,
      goalIds: [g.goalId],
      accommodation: null,
    })
  }
  if (profile.interests.length > 0 && firstGoal) {
    gaps.push({
      gapType: 'engagement',
      title: `Connect the task to ${profile.interests[0].toLowerCase()}`,
      why: `${profile.studentToken} engages more when the example uses a known interest.`,
      goalIds: [firstGoal],
      accommodation: null,
    })
  }
  return gaps
}

function lensAdaptations(input: LensForStudentInput): LensAdaptation[] {
  const { profile, subject } = input
  const token = profile.studentToken
  const out: LensAdaptation[] = profile.goals.map((g) => ({ ...adaptationForGoal(g, token), goalIds: [g.goalId] }))
  const subjectGoal =
    profile.goals.find((g) => g.area.toLowerCase().includes(subject.toLowerCase()) || /modified/i.test(g.area)) ?? profile.goals[0]

  if (subjectGoal && profile.modificationSubjects.includes(subject)) {
    out.push({
      adaptationType: 'modified_assessment',
      title: 'Assess the IEP outcome instead of the grade-level outcome',
      text: `Replace the grade-level exit slip with 3 items on the IEP outcome: ${subjectGoal.text}.`,
      why: `The IEP authorizes a modified ${subject} program for ${token}.`,
      goalIds: [subjectGoal.goalId],
      changesOutcome: true,
      modelLabel: 'modification',
    })
  } else if (subjectGoal && subject === 'math') {
    // A realistic model error kept on purpose: the outcome is reduced but the
    // model calls it an adaptation. The code guardrail must relabel and block it (PRD 1A-5).
    out.push({
      adaptationType: 'alternative_demonstration',
      title: 'Smaller numbers for the practice set',
      text: 'Let the student add single-digit numbers only, in place of two-digit addition with regrouping.',
      why: `Reduces load for ${token}.`,
      goalIds: [subjectGoal.goalId],
      changesOutcome: true,
      modelLabel: 'adaptation',
    })
  }

  // PRD 1A-9: favour adaptation types that worked better for this student (rows already meet the minimum sample).
  const score = (type: AdaptationType) => input.whatWorks.find((w) => w.adaptationType === type)?.meanOutcome ?? -1
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => score(y.a.adaptationType) - score(x.a.adaptationType) || x.i - y.i)
    .map(({ a }) => a)
}

function checkFor(goal: ProfileGoal, subject: string, seed: number): LensCheck | null {
  const o = goal.objective
  if (!o || (o.metricType !== 'accuracy' && o.metricType !== 'rubric')) return null
  const t = `${goal.area} ${goal.text}`.toLowerCase()
  if (o.metricType === 'rubric' || has(t, /retell|writ|explain/)) {
    return {
      goalId: goal.goalId,
      objectiveId: o.objectiveId,
      items: [{ id: 'q1', prompt: 'In one or two sentences, tell the main idea of today’s text in your own words.', format: 'short_answer', options: null }],
      answerKey: null,
      rubric: {
        criteria: [
          { id: 'main-idea', description: 'States the main idea' },
          { id: 'own-words', description: 'Uses own words, not copied text' },
        ],
        levels: [
          { score: 0, description: 'Not yet' },
          { score: 1, description: 'Partly' },
          { score: 2, description: 'Fully' },
        ],
      },
    }
  }
  if (subject === 'math' || has(t, /count|add|number|math/)) {
    const a = 3 + Math.floor(unitInterval(seed, 'a') * 7)
    const b = 2 + Math.floor(unitInterval(seed, 'b') * 8)
    return {
      goalId: goal.goalId,
      objectiveId: o.objectiveId,
      items: [
        { id: 'q1', prompt: `Use cubes. What is ${a} + ${b}?`, format: 'numeric', options: null },
        { id: 'q2', prompt: `Which is more: ${a + b} or ${a + b - 3}?`, format: 'multiple_choice', options: [`${a + b}`, `${a + b - 3}`] },
      ],
      answerKey: [
        { itemId: 'q1', accepted: [`${a + b}`] },
        { itemId: 'q2', accepted: [`${a + b}`] },
      ],
      rubric: null,
    }
  }
  return {
    goalId: goal.goalId,
    objectiveId: o.objectiveId,
    items: [{ id: 'q1', prompt: 'Circle the sentence that tells the main idea.', format: 'multiple_choice', options: ['A', 'B', 'C'] }],
    answerKey: [{ itemId: 'q1', accepted: [pick(['A', 'B', 'C'], seed, 'mc')] }],
    rubric: null,
  }
}

function lensForStudent(input: LensForStudentInput): LensForStudentOutput {
  const seed = hashOf(input)
  const checks = input.profile.goals
    .map((g) => checkFor(g, input.subject, seed))
    .filter((c): c is LensCheck => c !== null)
    .slice(0, 3)
  return { gaps: lensGaps(input), adaptations: lensAdaptations(input), checks }
}

// ---------- scorePhotoPage ----------

function scorePhotoPage(input: ScorePhotoPageInput): ScorePhotoPageOutput {
  const seed = hashOf({ fileKey: input.image.fileKey, check: input.check })
  const code = input.image.fileKey.match(/sheet[-_]?code[-_]([A-Za-z0-9-]+)/i)?.[1] ?? null
  const top = input.check.rubric ? Math.max(...input.check.rubric.levels.map((l) => l.score)) : 1
  return {
    sheetCode: code,
    items: input.check.items.map((item) => {
      const u = unitInterval(seed, item.id)
      const value = input.check.answerKey ? (u < 0.7 ? 1 : 0) : Math.round(u * top)
      return { itemId: item.id, value, confidence: round2(0.55 + unitInterval(seed, `c:${item.id}`) * 0.44) }
    }),
  }
}

// ---------- parseVoiceNote ----------

function parseVoiceNote(input: ParseVoiceNoteInput): ParseVoiceNoteOutput {
  const seed = hashOf({ fileKey: input.audio.fileKey, objectives: input.objectives })
  const events: VoiceEvent[] = []
  for (const o of input.objectives) {
    const confidence = round2(0.6 + unitInterval(seed, `c:${o.objectiveId}`) * 0.35)
    const base = { objectiveId: o.objectiveId, promptLevel: null, count: null, durationSeconds: null, confidence }
    if (o.metricType === 'prompt_level') {
      events.push({ ...base, kind: 'prompt_level', promptLevel: pick(PROMPT_LEVELS.slice(2), seed, o.objectiveId) })
    } else if (o.metricType === 'frequency' || o.metricType === 'rate') {
      events.push({ ...base, kind: 'counter', count: 1 + Math.floor(unitInterval(seed, o.objectiveId) * 3) })
    } else if (o.metricType === 'duration' || o.metricType === 'latency') {
      events.push({ ...base, kind: 'timer', durationSeconds: 60 * (2 + Math.floor(unitInterval(seed, o.objectiveId) * 10)) })
    }
  }
  return { events }
}

export function createFixtureProvider(): AiProvider {
  return {
    name: 'fixture',
    proposeObjectives: async (i) => proposeObjectives(i),
    analyseLesson: async (i) => analyseLesson(i),
    lensForStudent: async (i) => lensForStudent(i),
    scorePhotoPage: async (i) => scorePhotoPage(i),
    parseVoiceNote: async (i) => parseVoiceNote(i),
  }
}
