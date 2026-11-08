/**
 * EXAMPLE classroom for the Altamyra dashboard. Every student and staff member
 * is fictional. This is only the SEED: "Load example classroom" copies it into
 * the signed-in teacher's own collections (src/lib/classroom.ts), and the
 * dashboard reads from the database, never from this file.
 */

export type Proficiency = 'Emerging' | 'Developing' | 'Proficient' | 'Extending'

export type Goal = { id: string; area: string; text: string; level: Proficiency }

export type Student = {
  id: string
  name: string
  firstName: string
  profile: string
  goals: Goal[]
  modified?: boolean
}

export const STUDENTS: Student[] = [
  {
    id: 'kai',
    name: 'Kai Nakamura',
    firstName: 'Kai',
    profile: 'Autistic',
    goals: [
      { id: 'kai-r', area: 'Reading', text: 'Retell the main idea of a short text in his own words', level: 'Developing' },
      { id: 'kai-sr', area: 'Self-regulation', text: 'Ask for a break using his break card before he feels overwhelmed', level: 'Emerging' },
    ],
  },
  {
    id: 'amara',
    name: 'Amara Okonkwo',
    firstName: 'Amara',
    profile: 'Learning disability in writing',
    goals: [{ id: 'amara-w', area: 'Writing', text: 'Write 3 connected sentences about one idea using a planner', level: 'Developing' }],
  },
  {
    id: 'dev',
    name: 'Dev Malhotra',
    firstName: 'Dev',
    profile: 'ADHD',
    goals: [{ id: 'dev-a', area: 'Attention', text: 'Start independent work within 2 minutes using a first-then checklist', level: 'Proficient' }],
  },
  {
    id: 'sofia',
    name: 'Sofía Haddad',
    firstName: 'Sofía',
    profile: 'Mild intellectual disability, modified math program',
    modified: true,
    goals: [
      { id: 'sofia-m', area: 'Math (modified)', text: 'Count, compare and add groups to 20 with cubes', level: 'Developing' },
      { id: 'sofia-c', area: 'Communication', text: 'Share one idea in a full sentence during group talk', level: 'Emerging' },
    ],
  },
]

export const studentById = (id: string) => STUDENTS.find((s) => s.id === id)!

export type ClassStatus = 'done' | 'pulse' | 'next' | 'later'

export type ClassBlock = {
  time: string
  subject: string
  lesson: string
  studentIds: string[]
  status: ClassStatus
  suggestions: number
}

export const CLASSES: ClassBlock[] = [
  { time: '8:50 AM', subject: 'Morning circle', lesson: 'Check-in and day plan', studentIds: ['kai', 'amara', 'dev', 'sofia'], status: 'done', suggestions: 0 },
  { time: '9:15 AM', subject: 'Literacy', lesson: 'Salmon in our rivers: reading for the main idea', studentIds: ['kai', 'amara', 'dev', 'sofia'], status: 'pulse', suggestions: 0 },
  { time: '10:45 AM', subject: 'Numeracy', lesson: 'Multiplication with arrays', studentIds: ['sofia', 'dev', 'kai'], status: 'next', suggestions: 2 },
  { time: '12:50 PM', subject: 'Science', lesson: 'Watershed field notes', studentIds: ['amara', 'dev'], status: 'later', suggestions: 1 },
  { time: '2:05 PM', subject: 'Physical education', lesson: 'Cooperative games', studentIds: ['kai', 'dev'], status: 'later', suggestions: 0 },
]

export type Suggestion = {
  id: string
  studentId: string
  goalId: string
  lesson: string
  kind: 'adaptation' | 'modification'
  text: string
  why: string
}

export const SUGGESTIONS: Suggestion[] = [
  {
    id: 's1',
    studentId: 'sofia',
    goalId: 'sofia-m',
    lesson: 'Numeracy, 10:45 AM',
    kind: 'modification',
    text: 'Sofía builds equal groups to 20 with cubes and counts the total, instead of writing multiplication facts to 100.',
    why: 'Matches her modified math goal. The class outcome (multiplication to 100) does not apply to her.',
  },
  {
    id: 's2',
    studentId: 'dev',
    goalId: 'dev-a',
    lesson: 'Numeracy, 10:45 AM',
    kind: 'adaptation',
    text: 'Give Dev a 3-step first-then card for the array task and let him stand at the side counter.',
    why: 'Same outcome as the class. His Pulse notes show standing work helped him start on time last week.',
  },
  {
    id: 's3',
    studentId: 'amara',
    goalId: 'amara-w',
    lesson: 'Science, 12:50 PM',
    kind: 'adaptation',
    text: 'Amara dictates her field notes with speech-to-text, then picks 3 sentences to copy into her planner.',
    why: 'Same science outcome. She shows what she knows without the handwriting load.',
  },
]

export type Draft = {
  studentId: string
  report: string
  due: string
  linked: number
  sentences: number
}

export const DRAFTS: Draft[] = [
  { studentId: 'kai', report: 'Term 1 progress report', due: 'Due Nov 20', linked: 11, sentences: 11 },
  { studentId: 'sofia', report: 'Term 1 progress report', due: 'Due Nov 20', linked: 7, sentences: 9 },
  { studentId: 'amara', report: 'Term 1 progress report', due: 'Due Nov 27', linked: 4, sentences: 8 },
]

/** Next few dates that need the teacher (example). Nov 1, 2026 is a Sunday. */
export const COMING_UP = [
  { day: 'Wed', date: 'Nov 18', label: 'IEP review for Kai' },
  { day: 'Fri', date: 'Nov 20', label: 'Progress reports due' },
  { day: 'Tue', date: 'Nov 24', label: 'Team meeting' },
]

/** Pulse check-ins logged this week, against the weekly goal (example). */
export const PULSE = { done: 18, goal: 24 }
