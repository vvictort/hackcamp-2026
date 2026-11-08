import type { AnalyseLessonInput } from '../contract/ai'
import { DISTRICT, SCHOOL, SCHOOL_STUDENTS, STUDENT_FIXTURES, USERS, type StudentFixture } from '../fixtures'
import type { Roster } from './deidentify'

/**
 * FICTIONAL demo and test data for the AI module: the fixture school's
 * roster in de-identification form, and three grade 4 lessons (BC context)
 * that match the fixture classes. No real people.
 */

/** Invented student numbers and dates of birth so the scan covers those identifiers too. */
const EXTRA: Record<StudentFixture['key'], { studentNumber: string; dateOfBirth: string; email: string }> = {
  kai: { studentNumber: '990000101', dateOfBirth: '2016-04-12', email: 'kai.n@students.fictional.example' },
  amara: { studentNumber: '990000102', dateOfBirth: '2016-07-30', email: 'amara.o@students.fictional.example' },
  sofia: { studentNumber: '990000103', dateOfBirth: '2016-11-05', email: 'sofia.h@students.fictional.example' },
}

export const tokenFor = (studentId: string): string => {
  const s = SCHOOL_STUDENTS.find((x) => x.id === studentId)
  if (!s) throw new Error(`no fixture student ${studentId}`)
  return s.displayToken
}

export const FIXTURE_EXTRA_IDENTIFIERS = EXTRA

export function fixtureRoster(): Roster {
  return {
    students: STUDENT_FIXTURES.map((f) => ({
      token: tokenFor(f.studentId),
      firstName: f.iep.sections.student.firstName,
      lastName: f.iep.sections.student.lastName,
      preferredName: f.iep.sections.student.preferredName,
      ...EXTRA[f.key],
    })),
    people: USERS.map((u) => ({
      displayName: u.displayName,
      email: `${u.displayName.toLowerCase().replace(/\s+/g, '.')}@sd99.fictional.example`,
    })),
    schools: [SCHOOL.name, DISTRICT.name],
  }
}

export const FIXTURE_LESSONS = {
  literacy: {
    lessonId: '1e550000-0000-4000-8000-000000000001',
    title: 'The salmon life cycle',
    subject: 'literacy',
    grade: '4',
    text: [
      "Mr. Tran's Grade 4 class, Salmonberry Creek Elementary (fictional).",
      'Learning goal: I can identify the main idea of an informational text and retell it in my own words.',
      'Read the passage "From Egg to Spawner". Every fall, salmon return to the stream where they hatched.',
      'The eggs hatch into alevins, which grow into fry and then smolts before swimming out to the ocean.',
      'After a few years at sea, adult salmon swim back upstream to lay their eggs.',
      'Task: Write a paragraph that explains the main idea of the passage. Use two details from the text.',
      'Then discuss with a partner why salmon matter to the forest and to First Peoples in BC.',
    ].join('\n'),
    file: null,
  },
  numeracy: {
    lessonId: '1e550000-0000-4000-8000-000000000002',
    title: 'Adding two-digit numbers with regrouping',
    subject: 'math',
    grade: '4',
    text: [
      'Learning goal: I can add two-digit numbers with regrouping and explain my strategy.',
      'Warm-up: use base-ten blocks to show 27 + 15.',
      'Practice: solve 8 problems such as 46 + 38 and 59 + 24. Show your thinking with blocks or a number line.',
      'Exit slip: explain in writing how you regrouped in one problem.',
    ].join('\n'),
    file: null,
  },
  science: {
    lessonId: '1e550000-0000-4000-8000-000000000003',
    title: 'How plants use sunlight',
    subject: 'science',
    grade: '4',
    text: [
      'Learning goal: I can explain how plants use sunlight, water and air to make their own food.',
      'Look at the diagram of a leaf. Label where sunlight, water and air enter the plant.',
      'Experiment: place one bean plant in the dark and one by the window. Predict what will happen.',
      'Record your observations in a chart for one week.',
    ].join('\n'),
    file: null,
  },
} satisfies Record<string, AnalyseLessonInput>
