import type { SummaryAi } from '../ai/summaries'
import type { SummaryGenerateBody } from '../contract/api'
import { AltamyraError } from '../contract/errors'
import type { Summary } from '../contract/student'
import { HttpError } from '../middleware/errors'
import { studentsGet } from '../services/school'
import { familySummariesSave, summariesInputs, type SummaryInputs } from '../services/summaries'
import type { Req } from './context'

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
  if (inputs.existing?.status === 'approved') throw new HttpError('bad_request', 'This summary is already approved. Edit it to change it.')
  const { token } = await studentToken(r, studentId)
  const language = body.language ?? 'en'
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
