/**
 * The signed-in teacher's classroom, read from the database (collections in
 * src/schemas/classroom-schema.ts). `seed()` copies the fictional example
 * classroom into the teacher's own rows; it is only offered when they have
 * none. Rows are filtered by ownerId because admins can read every row.
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutations, useQuery, useUser } from 'deepspace'
import {
  CLASSES,
  COMING_UP,
  DRAFTS,
  PULSE,
  STUDENTS,
  SUGGESTIONS,
  type ClassBlock,
  type Draft,
  type Goal,
  type Student,
  type Suggestion,
} from '@/components/altamira/exampleData'

interface Owned {
  ownerId?: string
}
interface StudentRow extends Owned { key: string; name: string; firstName: string; profile: string; modified?: string; goals: string }
interface ClassRow extends Owned { sort: number; time: string; subject: string; lesson: string; studentIds: string; status: ClassBlock['status']; suggestions: number }
interface SuggestionRow extends Owned { studentKey: string; goalId: string; lesson: string; kind: Suggestion['kind']; text: string; why: string; state: string }
interface DraftRow extends Owned { studentKey: string; report: string; due: string; linked: number; sentences: number }
interface EventRow extends Owned { sort: number; day: string; date: string; label: string }
interface PulseRow extends Owned { done: number; goal: number }

const json = <T,>(s: string | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

export function useClassroom() {
  const { user } = useUser()
  const where = { ownerId: user?.id ?? '' }
  const q = { where }
  const students = useQuery<StudentRow>('students', q)
  const classBlocks = useQuery<ClassRow>('classBlocks', { ...q, orderBy: 'sort', orderDir: 'asc' })
  const suggestions = useQuery<SuggestionRow>('suggestions', q)
  const drafts = useQuery<DraftRow>('drafts', q)
  const events = useQuery<EventRow>('events', { ...q, orderBy: 'sort', orderDir: 'asc' })
  const pulse = useQuery<PulseRow>('pulse', q)

  const mStudents = useMutations<StudentRow>('students')
  const mClasses = useMutations<ClassRow>('classBlocks')
  const mSuggestions = useMutations<SuggestionRow>('suggestions')
  const mDrafts = useMutations<DraftRow>('drafts')
  const mEvents = useMutations<EventRow>('events')
  const mPulse = useMutations<PulseRow>('pulse')

  const [seeding, setSeeding] = useState(false)
  const all = [students, classBlocks, suggestions, drafts, events, pulse]
  const loading = !user || all.some((r) => r.status === 'loading')
  const failed = all.some((r) => r.status === 'error')
  const writable = [mStudents, mClasses, mSuggestions, mDrafts, mEvents, mPulse].every((m) => m.ready)

  const data = useMemo(() => {
    const studentList: Student[] = students.records.map((r) => ({
      id: r.data.key,
      name: r.data.name,
      firstName: r.data.firstName,
      profile: r.data.profile,
      modified: r.data.modified === 'yes',
      goals: json<Goal[]>(r.data.goals, []),
    }))
    const byId = new Map(studentList.map((s) => [s.id, s]))
    return {
      students: studentList,
      studentById: (id: string): Student => byId.get(id) ?? { id, name: 'Unknown student', firstName: 'Student', profile: '', goals: [] },
      classes: classBlocks.records.map((r): ClassBlock => ({
        time: r.data.time,
        subject: r.data.subject,
        lesson: r.data.lesson,
        studentIds: json<string[]>(r.data.studentIds, []),
        status: r.data.status,
        suggestions: r.data.suggestions,
      })),
      suggestions: suggestions.records
        .filter((r) => r.data.state !== 'done')
        .map((r): Suggestion => ({ id: r.recordId, studentId: r.data.studentKey, goalId: r.data.goalId, lesson: r.data.lesson, kind: r.data.kind, text: r.data.text, why: r.data.why })),
      drafts: drafts.records.map((r): Draft => ({ studentId: r.data.studentKey, report: r.data.report, due: r.data.due, linked: r.data.linked, sentences: r.data.sentences })),
      events: events.records.map((r) => ({ day: r.data.day, date: r.data.date, label: r.data.label })),
      pulse: pulse.records[0] ? { done: pulse.records[0].data.done, goal: pulse.records[0].data.goal } : { done: 0, goal: 0 },
    }
  }, [students.records, classBlocks.records, suggestions.records, drafts.records, events.records, pulse.records])

  const seed = useCallback(async () => {
    if (!user) return
    const ownerId = user.id
    setSeeding(true)
    try {
      await Promise.all([
        ...STUDENTS.map((s) => mStudents.createConfirmed({ ownerId, key: s.id, name: s.name, firstName: s.firstName, profile: s.profile, modified: s.modified ? 'yes' : 'no', goals: JSON.stringify(s.goals) })),
        ...CLASSES.map((c, sort) => mClasses.createConfirmed({ ownerId, sort, time: c.time, subject: c.subject, lesson: c.lesson, studentIds: JSON.stringify(c.studentIds), status: c.status, suggestions: c.suggestions })),
        ...SUGGESTIONS.map((s) => mSuggestions.createConfirmed({ ownerId, studentKey: s.studentId, goalId: s.goalId, lesson: s.lesson, kind: s.kind, text: s.text, why: s.why, state: 'pending' })),
        ...DRAFTS.map((d) => mDrafts.createConfirmed({ ownerId, studentKey: d.studentId, report: d.report, due: d.due, linked: d.linked, sentences: d.sentences })),
        ...COMING_UP.map((e, sort) => mEvents.createConfirmed({ ownerId, sort, ...e })),
        mPulse.createConfirmed({ ownerId, done: PULSE.done, goal: PULSE.goal }),
      ])
    } finally {
      setSeeding(false)
    }
  }, [user, mStudents, mClasses, mSuggestions, mDrafts, mEvents, mPulse])

  return { ...data, loading, failed, empty: !loading && !failed && students.records.length === 0, canSeed: writable && !seeding, seeding, seed }
}
