import type { AiFunctions } from '../ai/functions'
import { classifyAdaptation } from '../ai/guardrail'
import type { LensAdaptation } from '../contract/ai'
import type { MediaRef } from '../contract/common'
import type { LessonAnalysis } from '../contract/school'
import { lensContext, lensSaveRun } from '../services/lens'
import { lessonsGet, lessonsGetAnalysis, lessonsSaveAnalysis, studentsGet } from '../services/school'
import type { Req } from './context'

/** Lesson analysis and per-student lens steps shared by the lens, regenerate and sheet routes. */

export type LessonInfo = Awaited<ReturnType<typeof loadLesson>>

export function loadLesson(r: Req, lessonId: string) {
  return r.school(lessonsGet, { lessonId })
}

/**
 * PRD 1A-2: one analysis per lesson. The AI is called only when the school
 * room has no cached analysis; the room keeps the first one if two race.
 */
export async function ensureAnalysis(r: Req, info: LessonInfo, ai: AiFunctions, file: MediaRef | null = null): Promise<LessonAnalysis> {
  const { lesson, files } = info
  const cached = (await r.school(lessonsGetAnalysis, { lessonId: lesson.id })).analysis
  if (cached) return cached
  const stored = files[0] ? { fileKey: files[0].storageKey, contentType: files[0].contentType } : null
  const body = await ai.analyseLesson({
    lessonId: lesson.id,
    title: lesson.title,
    subject: info.subject,
    grade: info.grade,
    text: lesson.text,
    file: file ?? stored,
  })
  return (await r.school(lessonsSaveAnalysis, { lessonId: lesson.id, analysis: body, provider: ai.provider.name })).analysis
}

export async function studentToken(r: Req, studentId: string): Promise<{ token: string; grade: string }> {
  const { student } = await r.school(studentsGet, { studentId })
  return { token: student.displayToken, grade: student.grade }
}

/** The de-identified lens input for one student plus the IEP's modification subjects. */
export async function lensInput(r: Req, studentId: string) {
  const { token, grade } = await studentToken(r, studentId)
  return r.student(studentId, lensContext, { studentToken: token, grade })
}

/** PRD 1A-5: the label is decided in code from the adaptation and the lesson; the model's label is ignored. */
export function labelAdaptation(a: LensAdaptation, subject: string, analysis: LessonAnalysis, modificationSubjects: string[]) {
  const { label } = classifyAdaptation({ ...a, subject }, analysis.analysis, { modificationSubjects })
  return { ...a, label }
}

/** Runs the lens for one student (AI outside any transaction), applies the guardrail, then saves the run. */
export async function runLensForStudent(r: Req, ai: AiFunctions, info: LessonInfo, analysis: LessonAnalysis, studentId: string) {
  const ctx = await lensInput(r, studentId)
  const out = await ai.lensForStudent({
    lessonId: info.lesson.id,
    subject: info.subject,
    analysis: analysis.analysis,
    lessonText: info.lesson.text,
    profile: ctx.profile,
    whatWorks: ctx.whatWorks,
  })
  return r.student(studentId, lensSaveRun, {
    lessonId: info.lesson.id,
    analysisId: analysis.id,
    subject: info.subject,
    gaps: out.gaps,
    adaptations: out.adaptations.map((a) => labelAdaptation(a, info.subject, analysis, ctx.profile.modificationSubjects)),
    checks: out.checks,
  })
}
