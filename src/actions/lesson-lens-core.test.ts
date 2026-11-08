import { describe, expect, it } from 'vitest'
import { buildRequest, clipLesson, LIMITS, parseReply, sha256Hex, studentKey, type LensStudent } from './lesson-lens-core'

// Fictional students, same shape as the example classroom.
const sofia: LensStudent = {
  id: 'sofia',
  name: 'Sofía Haddad',
  firstName: 'Sofía',
  goals: [{ id: 'sofia-m', area: 'Math (modified)', text: 'Count and add groups to 20 with cubes', level: 'Developing' }],
}
const kai: LensStudent = {
  id: 'kai',
  name: 'Kai Nakamura',
  firstName: 'Kai',
  goals: [{ id: 'kai-r', area: 'Reading', text: 'Retell the main idea', level: 'Developing' }],
}
const amara: LensStudent = { id: 'amara', name: 'Amara Okonkwo', firstName: 'Amara', goals: [{ id: 'amara-w', area: 'Writing', text: 'Write 3 sentences', level: 'Developing' }] }
const noGoals: LensStudent = { id: 'dev', name: 'Dev Malhotra', firstName: 'Dev', goals: [] }

const build = (details?: string) =>
  buildRequest({
    teacher: 'hash',
    subject: 'Numeracy',
    lesson: 'Multiplication with arrays',
    details,
    inClass: [sofia, kai, noGoals],
    roster: [sofia, kai, amara, noGoals],
  })

const reply = (suggestions: unknown[], source = 'gemini') => ({ response: JSON.stringify({ suggestions, source }) })
const ok = { studentKey: 'Student A', goalId: 'g1', kind: 'adaptation', text: 'Give her cubes.', why: 'Her goal uses cubes.' }

describe('lesson lens: outgoing payload', () => {
  it('never contains a name, an id or a profile', () => {
    const { request } = build("sofía and Kai Nakamura pair up; KAI'S group helps Amara. Dev reads aloud. Haddad leads.")
    const out = JSON.stringify(request)
    for (const word of ['Sofía', 'sofía', 'Haddad', 'Kai', 'Nakamura', 'Amara', 'Okonkwo', 'Dev', 'Malhotra', 'sofia', 'kai']) {
      expect(out).not.toMatch(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu'))
    }
    expect(request.details).toBe("Student A and Student B pair up; Student B'S group helps a student. a student reads aloud. Student A leads.")
  })

  it('ignores accents, matches hyphen parts, and scrubs before clipping so no name fragment survives', () => {
    const jo: LensStudent = { id: 'jo', name: 'Mary-Jo Lee', firstName: 'Mary-Jo', goals: [{ id: 'jo-r', area: 'Reading', text: 'Jo reads', level: 'Lee' }] }
    const { request } = buildRequest({
      teacher: 'h', subject: 'S', lesson: 'L', inClass: [sofia, jo], roster: [sofia, jo],
      details: 'SOFIA and Sofia and Jo. ' + 'x'.repeat(3973) + ' Mary', // clipping first would leave "Ma"
    })
    const out = JSON.stringify(request)
    for (const word of ['sofia', 'jo', 'mary', 'lee']) expect(out).not.toMatch(new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu'))
    expect(request.details!.startsWith('Student A and Student A and Student B. ')).toBe(true)
    expect(request.details!.length).toBeLessThanOrEqual(LIMITS.details)
    expect(request.details).not.toMatch(/\bMa$/)
  })

  it('keys students in class order and leaves out students without goals', () => {
    const { request, map } = build()
    expect(request.students.map((s) => s.key)).toEqual(['Student A', 'Student B'])
    expect(request.students.map((s) => s.goals[0].id)).toEqual(['g1', 'g2'])
    expect(map.students.get('Student A')?.id).toBe('sofia')
    expect(request.details).toBeUndefined()
    expect(studentKey(26)).toBe('Student AA')
  })

  it('clips details and the saved lesson', () => {
    expect(build('x'.repeat(5000)).request.details).toHaveLength(LIMITS.details)
    expect(clipLesson('y'.repeat(200))).toHaveLength(LIMITS.lesson)
  })

  it('hashes the teacher id', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('lesson lens: reply validation', () => {
  const { map } = build()

  it('maps keys back to real ids', () => {
    expect(parseReply(reply([ok]), map)).toEqual({
      source: 'gemini',
      suggestions: [{ studentId: 'sofia', goalId: 'sofia-m', kind: 'adaptation', text: 'Give her cubes.', why: 'Her goal uses cubes.' }],
    })
  })

  it('puts first names back into saved text, inside the app only', () => {
    const r = parseReply(reply([{ ...ok, text: 'Give Student A cubes.', why: "Student A's goal; Student AB is unknown." }]), map)!
    expect(r.suggestions[0].text).toBe('Give Sofía cubes.')
    expect(r.suggestions[0].why).toBe("Sofía's goal; Student AB is unknown.")
  })

  it('drops unknown keys, goals that are not that student’s, and other kinds', () => {
    const r = parseReply(
      reply([
        { ...ok, studentKey: 'Student Z' },
        { ...ok, goalId: 'g2' },
        { ...ok, goalId: 'sofia-m' },
        { ...ok, kind: 'accommodation' },
        { ...ok, text: '   ' },
        null,
      ]),
      map,
    )
    expect(r?.suggestions).toEqual([])
  })

  it('clips text, caps two per student and restricts the source', () => {
    const long = { ...ok, text: 't'.repeat(900), why: 'w'.repeat(900) }
    const r = parseReply(reply([long, ok, ok], 'gpt'), map)!
    expect(r.source).toBe('rules')
    expect(r.suggestions).toHaveLength(2)
    expect(r.suggestions[0].text).toHaveLength(LIMITS.text)
    expect(r.suggestions[0].why).toHaveLength(LIMITS.why)
  })

  it('rejects a body that is not the contract', () => {
    expect(parseReply({ response: 'not json' }, map)).toBeNull()
    expect(parseReply({ response: '{"nope":1}' }, map)).toBeNull()
    expect(parseReply(null, map)).toBeNull()
  })
})
