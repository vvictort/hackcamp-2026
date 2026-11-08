import { promptLevelValue } from '../contract/enums'
import type { Consent, DataPoint, Goal, IepVersion, Objective, ProficiencyRating } from '../contract/student'
import { CLASS_IDS, SEEDED_AT, STUDENT_IDS, USER_IDS, type FixtureStudentKey } from './school'

/**
 * Three FICTIONAL CB-IEP students (PRD M0). Names, profiles and goal wording
 * match src/components/altamira/exampleData.ts. Sofía has a modified math
 * program authorized in her IEP (modificationSubjects: ["math"]).
 */

export type StudentFixture = {
  key: FixtureStudentKey
  /** The id used by the frontend example data. */
  exampleId: string
  studentId: string
  iep: IepVersion
  goals: (Goal & { exampleId: string })[]
  objectives: Objective[]
  dataPoints: DataPoint[]
  consents: Consent[]
  proficiency: ProficiencyRating[]
}

const PERIOD = '2026-27 Term 1'

const iep = (
  id: string,
  sections: IepVersion['sections'],
  modificationSubjects: string[] = [],
): IepVersion => ({
  id,
  version: 1,
  sections,
  modificationSubjects,
  sourceFileKey: null,
  importedBy: USER_IDS.caseManager,
  importedAt: SEEDED_AT,
  confirmedBy: USER_IDS.caseManager,
  confirmedAt: SEEDED_AT,
  rowVersion: 1,
})

const goal = (id: string, exampleId: string, area: string, text: string): Goal & { exampleId: string } => ({
  id,
  exampleId,
  iepVersion: 1,
  area,
  text,
  status: 'active',
  version: 1,
})

const objective = (o: Partial<Objective> & Pick<Objective, 'id' | 'goalId' | 'metricType' | 'unit' | 'target' | 'masteryRule' | 'captureMethod' | 'status'>): Objective => ({
  baseline: null,
  baselineMethod: null,
  reviewDate: '2027-06-15',
  flagReason: null,
  confirmedBy: o.status === 'confirmed' ? USER_IDS.caseManager : null,
  confirmedAt: o.status === 'confirmed' ? SEEDED_AT : null,
  version: 1,
  ...o,
})

const point = (p: Partial<DataPoint> & Pick<DataPoint, 'id' | 'objectiveId' | 'value' | 'unit' | 'source' | 'recorderId' | 'recordedAt' | 'status'>): DataPoint => ({
  classId: null,
  lessonId: null,
  activeAdaptations: [],
  aiConfidence: null,
  sourceRef: null,
  version: 1,
  supersedesId: null,
  reason: null,
  sessionDetail: null,
  ...p,
})

const rating = (id: string, goalId: string, level: ProficiencyRating['level']): ProficiencyRating => ({
  id,
  goalId,
  level,
  period: PERIOD,
  narrative: null,
  setBy: USER_IDS.teacher,
  setAt: SEEDED_AT,
})

// ---------------- Kai ----------------

const KAI_GOALS = {
  reading: '6a000000-0000-4000-8000-0000000000a1',
  selfReg: '6a000000-0000-4000-8000-0000000000a2',
}
const KAI_OBJ = {
  reading: '0b000000-0000-4000-8000-0000000000a1',
  selfReg: '0b000000-0000-4000-8000-0000000000a2',
}

/** Weekly school days in Sep-Oct 2026 for the break-card series. */
const KAI_BREAK_CARD: [string, number, DataPoint['status']][] = [
  ['2026-09-14T19:00:00.000Z', 1, 'confirmed'],
  ['2026-09-18T19:00:00.000Z', 1, 'confirmed'],
  ['2026-09-23T19:00:00.000Z', 2, 'confirmed'],
  ['2026-09-29T19:00:00.000Z', 2, 'auto_confirmed'],
  ['2026-10-05T19:00:00.000Z', 3, 'confirmed'],
  ['2026-10-09T19:00:00.000Z', 2, 'confirmed'],
  ['2026-10-15T19:00:00.000Z', 3, 'auto_confirmed'],
  ['2026-10-21T19:00:00.000Z', 4, 'pending_review'],
]

export const KAI: StudentFixture = {
  key: 'kai',
  exampleId: 'kai',
  studentId: STUDENT_IDS.kai,
  iep: iep('1e000000-0000-4000-8000-0000000000a1', {
    student: { firstName: 'Kai', lastName: 'Nakamura', preferredName: null, grade: '4' },
    profile: {
      designation: 'Autistic',
      strengths: ['Strong visual memory', 'Careful, accurate with routines he knows'],
      interests: ['Salmon and rivers', 'Trains', 'Drawing maps'],
      stretches: ['Retelling what he read in his own words', 'Asking for a break before he is overwhelmed'],
    },
    coreCompetencies: {
      communication: 'Shares facts about topics he enjoys; is building retell skills.',
      thinking: 'Notices patterns and details quickly.',
      personalSocial: 'Is learning to recognise early signs of overload and use his break card.',
    },
    goals: [
      { area: 'Reading', text: 'Retell the main idea of a short text in his own words' },
      { area: 'Self-regulation', text: 'Ask for a break using his break card before he feels overwhelmed' },
    ],
    accommodations: ['Visual schedule for the day', 'Instructions given one step at a time', 'Noise-reducing headphones during independent work'],
    supports: ['Break card', 'First-then board', 'Read-aloud for texts above grade 2 level'],
    modifications: [],
    reviewDate: '2027-06-15',
  }),
  goals: [
    goal(KAI_GOALS.reading, 'kai-r', 'Reading', 'Retell the main idea of a short text in his own words'),
    goal(KAI_GOALS.selfReg, 'kai-sr', 'Self-regulation', 'Ask for a break using his break card before he feels overwhelmed'),
  ],
  objectives: [
    objective({
      id: KAI_OBJ.reading,
      goalId: KAI_GOALS.reading,
      metricType: 'accuracy',
      unit: '% correct',
      baseline: 40,
      target: 80,
      masteryRule: '80% or higher on 3 consecutive embedded checks',
      captureMethod: 'photo',
      status: 'confirmed',
    }),
    objective({
      id: KAI_OBJ.selfReg,
      goalId: KAI_GOALS.selfReg,
      metricType: 'frequency',
      unit: 'break card uses per day',
      baseline: 1,
      target: 4,
      masteryRule: '4 or more independent break-card requests per day for 2 weeks',
      captureMethod: 'ea',
      status: 'confirmed',
    }),
  ],
  dataPoints: [
    ...KAI_BREAK_CARD.map(([recordedAt, value, status], i) =>
      point({
        id: `d9000000-0000-4000-8000-0000000a2${String(i).padStart(3, '0')}`,
        objectiveId: KAI_OBJ.selfReg,
        value,
        unit: 'break card uses per day',
        source: 'ea',
        recorderId: USER_IDS.ea,
        recordedAt,
        status,
        sourceRef: `ea_event:counter:${i}`,
      }),
    ),
    point({
      id: 'd9000000-0000-4000-8000-0000000a1001',
      objectiveId: KAI_OBJ.reading,
      value: 50,
      unit: '% correct',
      source: 'photo',
      recorderId: USER_IDS.teacher,
      recordedAt: '2026-10-06T17:00:00.000Z',
      classId: CLASS_IDS.literacy,
      aiConfidence: 0.94,
      status: 'confirmed',
      sourceRef: 'photo:fixtures/sheet-kai-1.jpg#item-1',
    }),
    point({
      id: 'd9000000-0000-4000-8000-0000000a1002',
      objectiveId: KAI_OBJ.reading,
      value: 33,
      unit: '% correct',
      source: 'photo',
      recorderId: USER_IDS.teacher,
      recordedAt: '2026-10-20T17:00:00.000Z',
      classId: CLASS_IDS.literacy,
      aiConfidence: 0.41,
      status: 'pending_review',
      sourceRef: 'photo:fixtures/sheet-kai-2.jpg#item-1',
    }),
  ],
  consents: [
    {
      id: 'c0000000-0000-4000-8000-0000000000a1',
      kind: 'video',
      grantedBy: USER_IDS.parentKai,
      recordedBy: USER_IDS.parentKai,
      grantedAt: SEEDED_AT,
      revokedAt: null,
      version: 1,
    },
  ],
  proficiency: [
    rating('9f000000-0000-4000-8000-0000000000a1', KAI_GOALS.reading, 'Developing'),
    rating('9f000000-0000-4000-8000-0000000000a2', KAI_GOALS.selfReg, 'Emerging'),
  ],
}

// ---------------- Amara ----------------

const AMARA_GOAL = '6a000000-0000-4000-8000-0000000000b1'
const AMARA_OBJ = '0b000000-0000-4000-8000-0000000000b1'

export const AMARA: StudentFixture = {
  key: 'amara',
  exampleId: 'amara',
  studentId: STUDENT_IDS.amara,
  iep: iep('1e000000-0000-4000-8000-0000000000b1', {
    student: { firstName: 'Amara', lastName: 'Okonkwo', preferredName: null, grade: '4' },
    profile: {
      designation: 'Learning disability in writing',
      strengths: ['Rich oral vocabulary', 'Strong science reasoning'],
      interests: ['Plants and gardening', 'Telling stories'],
      stretches: ['Getting ideas onto paper', 'Connecting sentences around one idea'],
    },
    coreCompetencies: {
      communication: 'Explains ideas clearly out loud; written output is the stretch.',
      thinking: 'Asks good questions and makes predictions.',
      personalSocial: 'Works well with a partner.',
    },
    goals: [{ area: 'Writing', text: 'Write 3 connected sentences about one idea using a planner' }],
    accommodations: ['Speech-to-text for written work', 'Extra time for writing tasks', 'Graphic organizer or planner'],
    supports: ['Sentence frames', 'Word bank'],
    modifications: [],
    reviewDate: '2027-06-15',
  }),
  goals: [goal(AMARA_GOAL, 'amara-w', 'Writing', 'Write 3 connected sentences about one idea using a planner')],
  objectives: [
    objective({
      id: AMARA_OBJ,
      goalId: AMARA_GOAL,
      metricType: 'prompt_level',
      unit: 'prompt level',
      baseline: promptLevelValue('model'),
      baselineMethod: 'Median prompt level over the first 3 writing tasks',
      target: promptLevelValue('independent'),
      masteryRule: 'Independent on 3 of the last 4 writing tasks',
      captureMethod: 'ea',
      // Proposed, not yet confirmed: exercises the objective confirmation flow.
      status: 'proposed',
    }),
  ],
  dataPoints: [],
  // No consents: voice notes and videos must be refused for Amara.
  consents: [],
  proficiency: [rating('9f000000-0000-4000-8000-0000000000b1', AMARA_GOAL, 'Developing')],
}

// ---------------- Sofía ----------------

const SOFIA_GOALS = {
  math: '6a000000-0000-4000-8000-0000000000c1',
  communication: '6a000000-0000-4000-8000-0000000000c2',
}
const SOFIA_OBJ = {
  math: '0b000000-0000-4000-8000-0000000000c1',
  communication: '0b000000-0000-4000-8000-0000000000c2',
}

export const SOFIA: StudentFixture = {
  key: 'sofia',
  exampleId: 'sofia',
  studentId: STUDENT_IDS.sofia,
  iep: iep(
    '1e000000-0000-4000-8000-0000000000c1',
    {
      student: { firstName: 'Sofía', lastName: 'Haddad', preferredName: null, grade: '4' },
      profile: {
        designation: 'Mild intellectual disability',
        strengths: ['Friendly and encouraging with classmates', 'Persistent with hands-on tasks'],
        interests: ['Music', 'Animals', 'Building with blocks'],
        stretches: ['Number sense to 20', 'Sharing ideas in full sentences'],
      },
      coreCompetencies: {
        communication: 'Uses short phrases in group talk; building to full sentences.',
        thinking: 'Learns best with concrete materials.',
        personalSocial: 'Enjoys helping peers and classroom jobs.',
      },
      goals: [
        { area: 'Math (modified)', text: 'Count, compare and add groups to 20 with cubes' },
        { area: 'Communication', text: 'Share one idea in a full sentence during group talk' },
      ],
      accommodations: ['Manipulatives (cubes, ten frames)', 'Fewer items per page', 'Visual supports (pictograms)'],
      supports: ['Sentence starters for group talk', 'Peer buddy'],
      modifications: [{ subject: 'math', description: 'Modified math program: counting, comparing and adding to 20 with manipulatives' }],
      reviewDate: '2027-06-15',
    },
    ['math'],
  ),
  goals: [
    goal(SOFIA_GOALS.math, 'sofia-m', 'Math (modified)', 'Count, compare and add groups to 20 with cubes'),
    goal(SOFIA_GOALS.communication, 'sofia-c', 'Communication', 'Share one idea in a full sentence during group talk'),
  ],
  objectives: [
    objective({
      id: SOFIA_OBJ.math,
      goalId: SOFIA_GOALS.math,
      metricType: 'accuracy',
      unit: '% correct',
      baseline: 50,
      target: 80,
      masteryRule: '80% or higher on 3 consecutive embedded checks',
      captureMethod: 'photo',
      status: 'confirmed',
    }),
    objective({
      id: SOFIA_OBJ.communication,
      goalId: SOFIA_GOALS.communication,
      metricType: 'frequency',
      unit: 'full-sentence contributions per group talk',
      baseline: 0,
      target: 2,
      masteryRule: '2 or more full-sentence contributions in 4 of 5 group talks',
      captureMethod: 'ea',
      status: 'proposed',
    }),
  ],
  dataPoints: [
    point({
      id: 'd9000000-0000-4000-8000-0000000c1001',
      objectiveId: SOFIA_OBJ.math,
      value: 60,
      unit: '% correct',
      source: 'photo',
      recorderId: USER_IDS.ea,
      recordedAt: '2026-10-07T18:30:00.000Z',
      classId: CLASS_IDS.numeracy,
      aiConfidence: 0.97,
      status: 'auto_confirmed',
      sourceRef: 'photo:fixtures/sheet-sofia-1.jpg#item-1',
    }),
    point({
      id: 'd9000000-0000-4000-8000-0000000c1002',
      objectiveId: SOFIA_OBJ.math,
      value: 70,
      unit: '% correct',
      source: 'photo',
      recorderId: USER_IDS.ea,
      recordedAt: '2026-10-14T18:30:00.000Z',
      classId: CLASS_IDS.numeracy,
      status: 'confirmed',
      sourceRef: 'photo:fixtures/sheet-sofia-1.jpg#item-2',
    }),
  ],
  consents: [
    {
      id: 'c0000000-0000-4000-8000-0000000000c1',
      kind: 'video',
      grantedBy: USER_IDS.parentSofia,
      recordedBy: USER_IDS.parentSofia,
      grantedAt: SEEDED_AT,
      revokedAt: null,
      version: 1,
    },
    {
      id: 'c0000000-0000-4000-8000-0000000000c2',
      kind: 'voice_note',
      grantedBy: USER_IDS.parentSofia,
      recordedBy: USER_IDS.parentSofia,
      grantedAt: SEEDED_AT,
      revokedAt: null,
      version: 1,
    },
  ],
  proficiency: [
    rating('9f000000-0000-4000-8000-0000000000c1', SOFIA_GOALS.math, 'Developing'),
    rating('9f000000-0000-4000-8000-0000000000c2', SOFIA_GOALS.communication, 'Emerging'),
  ],
}

export const STUDENT_FIXTURES: StudentFixture[] = [KAI, AMARA, SOFIA]

export const studentFixture = (key: FixtureStudentKey): StudentFixture =>
  STUDENT_FIXTURES.find((s) => s.key === key) as StudentFixture
