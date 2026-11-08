import type { Hono } from 'hono'
import { z } from 'zod'
import { FamilyConsentBody, FamilyConsentsResponse, SummariesQuery, SummariesResponse } from '../contract/api'
import { synthesizeSpeech, type TtsEnv } from '../ai/tts'
import { HttpError } from '../middleware/errors'
import type { AltamyraEnv } from '../middleware/auth'
import { consentsSet } from '../services/family'
import { familySummariesList } from '../services/summaries'
import type { Kit } from './context'

/**
 * Parent consent, summaries and read-aloud audio. A parent reaches only
 * their own child's approved summaries and the consent toggles.
 */
export function familyRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, req } = kit

  /** Parents toggle consent for voice notes and videos; nobody else can. */
  app.put('/family/:id/consents', signedIn, mw.requireCapability('consent.manage'), async (c) => {
    const r = req(c)
    const body = await r.body(FamilyConsentBody)
    return r.json(FamilyConsentsResponse, await r.student(r.param('id'), consentsSet, body))
  })

  /** Summaries of one child. The room filters by role: the parent gets approved monthly summaries only. */
  app.get('/family/:id/summaries', signedIn, mw.requireCapability('summary.view'), async (c) => {
    const r = req(c)
    return r.json(SummariesResponse, await r.student(r.param('id'), familySummariesList, r.query(SummariesQuery)))
  })

  app.get('/students/:id/summaries', signedIn, mw.requireCapability('summary.view'), async (c) => {
    const r = req(c)
    return r.json(SummariesResponse, await r.student(r.param('id'), familySummariesList, r.query(SummariesQuery)))
  })

  /**
   * Read-aloud audio. Text is de-identified before it leaves (when studentId is
   * given, with that student's roster). 204 means "no audio, use browser speech".
   * Audio for parents needs no consent. With a studentId the caller must be able to
   * view summaries of that student, and anyone but the EA or teacher may only play the
   * text of an approved summary (its text, translation or audio script).
   */
  app.post('/tts', signedIn, async (c) => {
    const r = req(c)
    const raw = await c.req.json().catch(() => null)
    const parsed = z.object({ text: z.string().trim().min(1).max(2000), language: z.string().max(16).default('en'), studentId: z.string().max(64).optional() }).safeParse(raw)
    if (!parsed.success) throw new HttpError('bad_request', 'Text is required and must be 2000 characters or fewer.')
    const { text, studentId } = parsed.data
    if (studentId) {
      r.allow('summary.view', studentId)
      if (!r.can('summary.edit', studentId)) {
        const { summaries } = await r.student(studentId, familySummariesList)
        const playable = new Set(summaries.flatMap((s) => [s.text, s.translatedText, s.audioScript]).filter((t): t is string => !!t))
        if (!playable.has(text)) throw new HttpError('forbidden', 'Only approved summaries can be read aloud.')
      }
    }
    const ai = await r.ai(studentId ? [studentId] : [])
    const audio = await synthesizeSpeech(ai.deidText(text), c.env as unknown as TtsEnv)
    if (!audio) return c.body(null, 204)
    return c.body(audio as unknown as ArrayBuffer, 200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' })
  })
}
