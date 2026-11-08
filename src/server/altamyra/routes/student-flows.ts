import type { SummaryAi } from '../ai/summaries'
import type { DevSeedResponse, SummaryGenerateBody } from '../contract/api'
import { AltamyraError } from '../contract/errors'
import type { Summary } from '../contract/student'
import { devResetSchool, studentDevSeedDemo } from '../fixtures/demo'
import { DISTRICT, FAMILY_LANGUAGE, SCHOOL, SCHOOL_STUDENTS, USER_IDS } from '../fixtures/school'
import { deidStudentNames } from '../services/deid'
import { schoolDevSeed, studentsGet } from '../services/school'
import { familySummariesSave, summariesInputs, type SummaryInputs } from '../services/summaries'
import type { Req } from './context'

/**
 * The name people at the school see for a student: the preferred name, else the first name, from the latest IEP.
 * Only for the student's staff, their parents or guardians, and a school administrator. Null for anyone else, so a
 * district lead never sees a name. Names never go to the AI: AI calls use the display token (ai/deidentify.ts).
 */
export async function studentName(r: Req, studentId: string): Promise<string | null> {
  const a = r.actor
  if (!(a.studentRoles[studentId]?.length || a.parentOf.includes(studentId) || a.schoolAdminOf.length)) return null
  const { names } = await r.student(studentId, deidStudentNames)
  const latest = names.at(-1)
  return latest ? (latest.preferredName ?? latest.firstName) : null
}

/** The student's name when the caller may see it, else the display token. */
export async function studentLabel(r: Req, studentId: string, token: string): Promise<string> {
  return (await studentName(r, studentId)) ?? token
}

/** The student's de-identified display token and grade, shared by the capture, family and progress routes. */
export async function studentToken(r: Req, studentId: string): Promise<{ token: string; grade: string }> {
  const { student } = await r.school(studentsGet, { studentId })
  return { token: student.displayToken, grade: student.grade }
}

type Drafted = { text: string; translatedText: string | null; language: string | null }

/** Calls the right drafting function for the kind. `trim` drops free-text notes (the last-resort retry after a de-identification refusal). */
async function compose(ai: SummaryAi, token: string, inputs: SummaryInputs, language: string, trim: boolean): Promise<Drafted> {
  if (inputs.daily) {
    const out = await ai.draftDailySummary({ studentToken: token, date: inputs.daily.date, dataPoints: inputs.daily.dataPoints, events: [], notes: trim ? [] : inputs.daily.notes })
    return { text: out.text, translatedText: null, language: null }
  }
  if (inputs.weekly) {
    const w = inputs.weekly
    const out = await ai.draftWeeklyCaseloadSummary({
      weekStart: w.weekStart,
      students: [{ studentRef: token, objectives: w.objectives, notableEvents: trim ? [] : w.notableEvents }],
    })
    return { text: out.perStudent[0]?.text ?? out.overview, translatedText: null, language: null }
  }
  if (!inputs.monthly) throw new AltamyraError('bad_request', 'nothing to summarise')
  const m = inputs.monthly
  const out = await ai.draftMonthlyFamilySummary({ month: m.month, studentToken: token, objectives: m.objectives, highlights: m.highlights, language })
  const translated = out.language !== 'en' && out.text !== out.englishText
  return { text: out.englishText, translatedText: translated ? out.text : null, language: translated ? out.language : 'en' }
}

/**
 * Drafts one summary with Gemini on de-identified, confirmed data only and stores it as a DRAFT.
 * Gemini failures fall back to the deterministic fixture provider. Throws when the summary is already approved.
 */
export async function draftSummary(r: Req, studentId: string, body: SummaryGenerateBody): Promise<Summary> {
  const inputs = await r.student(studentId, summariesInputs, { kind: body.kind, period: body.period })
  if (inputs.existing?.status === 'approved') throw new AltamyraError('bad_request', 'This summary is already approved. Edit it to change it.')
  const { token } = await studentToken(r, studentId)
  const language = body.language ?? FAMILY_LANGUAGE[studentId] ?? 'en'
  let drafted: Drafted | null = null
  let failure: unknown
  for (const attempt of [{ fixture: false, trim: false }, { fixture: true, trim: false }, { fixture: true, trim: true }]) {
    try {
      drafted = await compose(await r.summaryAi([studentId], attempt.fixture), token, inputs, language, attempt.trim)
      break
    } catch (err) {
      if (err instanceof AltamyraError && err.code === 'forbidden') throw err
      failure = err
    }
  }
  if (!drafted) throw failure
  return (await r.student(studentId, familySummariesSave, { kind: body.kind, period: inputs.period, ...drafted })).summary
}

/**
 * Loads the fictional school and its students when the school room is empty (or wipes and reloads it with `reset`).
 * Calling it on a seeded school changes nothing, so a second press or a second person never fails.
 */
export async function seedDemoSchool(r: Req, reset = false): Promise<DevSeedResponse> {
  if (reset) await r.school(devResetSchool)
  const fixtureIds = { schoolId: SCHOOL.id, districtId: DISTRICT.id, studentIds: SCHOOL_STUDENTS.map((s) => s.id), userIds: { ...USER_IDS } as Record<string, string> }
  let fresh = reset
  let seeded = fixtureIds
  if (!reset) {
    try {
      seeded = await r.school(schoolDevSeed, {})
      fresh = true
    } catch (e) {
      if (!(e instanceof Error && /already seeded/.test(e.message))) throw e
    }
  }
  if (fresh) for (const studentId of seeded.studentIds) await r.student(studentId, studentDevSeedDemo, reset ? { reset: true } : {})
  return seeded
}
