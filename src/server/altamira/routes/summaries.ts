import type { Hono } from 'hono'
import { AltamiraError } from '../contract/errors'
import {
  PendingSummariesResponse,
  SummaryApproveBody,
  SummaryGenerateBody,
  SummaryPatchBody,
  SummaryResponse,
  WeeklySummariesResponse,
} from '../contract/api'
import type { Summary } from '../contract/student'
import type { SummaryAi } from '../ai/summaries'
import type { AltamiraEnv } from '../middleware/auth'
import { HttpError } from '../middleware/errors'
import { familySummariesApprove, familySummariesList, familySummariesSave, summariesEdit, summariesInputs, summariesPending, type SummaryInputs } from '../services/summaries'
import type { Kit, Req } from './context'
import { studentToken } from './lens-flow'

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
  if (!inputs.monthly) throw new AltamiraError('bad_request', 'nothing to summarise')
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
      if (err instanceof AltamiraError && err.code === 'forbidden') throw err
      failure = err
    }
  }
  if (!drafted) throw failure
  return (await r.student(studentId, familySummariesSave, { kind: body.kind, period: inputs.period, ...drafted })).summary
}

const isEaOrTeacher = (r: Req, studentId: string) => (r.actor.studentRoles[studentId] ?? []).some((role) => role === 'ea' || role === 'teacher')

/** Daily, weekly and monthly summaries: AI drafts, edited and approved by the EA or teacher only. */
export function summariesRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, req } = kit

  /** Gemini drafts a summary (regenerating the draft of the same period). Never visible to its audience until approved. */
  app.post('/students/:id/summaries/generate', signedIn, mw.requireCapability('summary.edit'), async (c) => {
    const r = req(c)
    const body = await r.body(SummaryGenerateBody)
    return r.json(SummaryResponse, { summary: await draftSummary(r, r.param('id'), body) }, 201)
  })

  /** Edit text (and translation). Editing an approved summary returns it to draft. */
  app.patch('/summaries/:sid', signedIn, async (c) => {
    const r = req(c)
    const body = await r.body(SummaryPatchBody)
    r.allow('summary.edit', body.studentId)
    const { studentId, ...fields } = body
    return r.json(SummaryResponse, await r.student(studentId, summariesEdit, { summaryId: r.param('sid'), ...fields }))
  })

  /** The EA or teacher approves the exact version they saw: text, translation and audio script together. */
  app.post('/summaries/:sid/approve', signedIn, async (c) => {
    const r = req(c)
    const body = await r.body(SummaryApproveBody)
    r.allow('summary.approve', body.studentId)
    return r.json(SummaryResponse, await r.student(body.studentId, familySummariesApprove, { summaryId: r.param('sid'), version: body.version }))
  })

  /** Drafts waiting for approval across the caller's students (EA home and teacher home). */
  app.get('/me/summaries/pending', signedIn, async (c) => {
    const r = req(c)
    const out = []
    for (const studentId of r.staffStudentIds().filter((id) => isEaOrTeacher(r, id))) {
      const { token } = await studentToken(r, studentId)
      for (const s of (await r.student(studentId, summariesPending)).summaries) out.push({ ...s, studentId, label: token })
    }
    return r.json(PendingSummariesResponse, { summaries: out })
  })

  /** Case manager: approved weekly summaries across the caseload. Drafts never appear. */
  app.get('/me/weekly', signedIn, async (c) => {
    const r = req(c)
    const out = []
    for (const studentId of r.staffStudentIds().filter((id) => (r.actor.studentRoles[id] ?? []).includes('case_manager'))) {
      const { token } = await studentToken(r, studentId)
      for (const s of (await r.student(studentId, familySummariesList, { kind: 'weekly' })).summaries) {
        if (s.status === 'approved') out.push({ id: s.id, studentId, label: token, period: s.period, text: s.text, approvedAt: s.approvedAt })
      }
    }
    out.sort((a, b) => b.period.localeCompare(a.period))
    return r.json(WeeklySummariesResponse, { summaries: out })
  })
}
