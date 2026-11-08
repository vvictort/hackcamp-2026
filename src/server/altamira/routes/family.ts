import type { Hono } from 'hono'
import { z } from 'zod'
import {
  FamilyConsentBody,
  FamilyConsentsResponse,
  FamilySummariesResponse,
  FamilySummaryApproveBody,
  FamilySummaryResponse,
} from '../contract/api'
import { synthesizeSpeech, type TtsEnv } from '../ai/tts'
import { HttpError } from '../middleware/errors'
import type { AltamiraEnv } from '../middleware/auth'
import { consentsSet, familySummariesApprove, familySummariesList } from '../services/family'
import type { Kit } from './context'

/**
 * Parent consent, summaries and read-aloud audio. A parent reaches only
 * their own child's approved summaries and the consent toggles.
 */
export function familyRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req } = kit

  /** Parents toggle consent for voice notes and videos; nobody else can. */
  app.put('/family/:id/consents', signedIn, mw.requireCapability('consent.manage'), async (c) => {
    const r = req(c)
    const body = await r.body(FamilyConsentBody)
    return r.json(FamilyConsentsResponse, await r.student(r.param('id'), consentsSet, body))
  })

  /** Summaries of one child. The room filters: parents and case managers get approved ones only. */
  app.get('/family/:id/summaries', signedIn, mw.requireCapability('summary.view'), async (c) => {
    const r = req(c)
    return r.json(FamilySummariesResponse, await r.student(r.param('id'), familySummariesList))
  })

  app.get('/students/:id/summaries', signedIn, mw.requireCapability('summary.view'), async (c) => {
    const r = req(c)
    return r.json(FamilySummariesResponse, await r.student(r.param('id'), familySummariesList))
  })

  /** The EA or the teacher approves (and may edit) a summary before it reaches its audience. */
  app.post('/family-summaries/:fsid/approve', signedIn, studentRef, mw.requireCapability('summary.approve'), async (c) => {
    const r = req(c)
    const body = await r.body(FamilySummaryApproveBody)
    return r.json(FamilySummaryResponse, await r.student(r.studentRef(), familySummariesApprove, { summaryId: r.param('fsid'), ...body }))
  })

  /**
   * Read-aloud audio. Text is de-identified before it leaves (when studentId is
   * given, with that student's roster). 204 means "no audio, use browser speech".
   * Audio for parents needs no consent. With a studentId the caller must be able to
   * view summaries of that student.
   */
  app.post('/tts', signedIn, async (c) => {
    const r = req(c)
    const raw = await c.req.json().catch(() => null)
    const parsed = z.object({ text: z.string().trim().min(1).max(2000), language: z.string().max(16).default('en'), studentId: z.string().max(64).optional() }).safeParse(raw)
    if (!parsed.success) throw new HttpError('bad_request', 'Text is required and must be 2000 characters or fewer.')
    const { text, studentId } = parsed.data
    if (studentId) r.allow('summary.view', studentId)
    const ai = await r.ai(studentId ? [studentId] : [])
    const audio = await synthesizeSpeech(ai.deidText(text), c.env as unknown as TtsEnv)
    if (!audio) return c.body(null, 204)
    return c.body(audio as unknown as ArrayBuffer, 200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' })
  })
}
