import type { Hono } from 'hono'
import {
  PendingSummariesResponse,
  SummaryApproveBody,
  SummaryGenerateBody,
  SummaryPatchBody,
  SummaryResponse,
  WeeklySummariesResponse,
} from '../contract/api'
import type { AltamyraEnv } from '../middleware/auth'
import { familySummariesApprove, familySummariesList, summariesEdit, summariesPending } from '../services/summaries'
import type { Kit } from './context'
import { draftSummary, studentLabel, studentToken } from './student-flows'

/** Daily, weekly and monthly summaries: AI drafts, edited and approved by the EA or teacher only. */
export function summariesRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
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
    for (const studentId of r.staffStudentIds().filter((id) => r.can('summary.edit', id))) {
      const label = await studentLabel(r, studentId, (await studentToken(r, studentId)).token)
      for (const s of (await r.student(studentId, summariesPending)).summaries) out.push({ ...s, studentId, label })
    }
    return r.json(PendingSummariesResponse, { summaries: out })
  })

  /** Case manager: approved weekly summaries across the caseload. Drafts never appear. */
  app.get('/me/weekly', signedIn, async (c) => {
    const r = req(c)
    const out = []
    for (const studentId of r.staffStudentIds().filter((id) => r.can('summary.caseload', id))) {
      const label = await studentLabel(r, studentId, (await studentToken(r, studentId)).token)
      for (const s of (await r.student(studentId, familySummariesList, { kind: 'weekly' })).summaries) {
        if (s.status === 'approved') out.push({ id: s.id, studentId, label, period: s.period, text: s.text, approvedAt: s.approvedAt })
      }
    }
    out.sort((a, b) => b.period.localeCompare(a.period))
    return r.json(WeeklySummariesResponse, { summaries: out })
  })
}
