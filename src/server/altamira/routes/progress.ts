import type { Hono } from 'hono'
import { applyReportingRules, checkCitations } from '../ai/citations'
import {
  AimlineResponse,
  DraftCreateBody,
  DraftMarkUsedBody,
  DraftPatchBody,
  DraftResponse,
  ProficiencyResponse,
  ProficiencySetBody,
  SessionCreateResponse,
  SessionNextResponse,
  SessionProgressResponse,
  SessionResponseBody,
  SessionResponseResult,
  WhatWorksResponse,
} from '../contract/api'
import type { AltamiraEnv } from '../middleware/auth'
import { HttpError } from '../middleware/errors'
import { startStudentSession } from '../middleware/session'
import { aimlineGet, draftsContext, draftsMarkUsed, draftsSave, draftsUpdate, proficiencySet, whatWorksGet } from '../services/insight'
import { sessionsNext, sessionsProgress, sessionsRespond, sessionsStart } from '../services/student-mode'
import type { Kit, Req } from './context'
import { studentToken } from './lens-flow'

/** The student behind a student-mode session (set by studentSessionAuth). */
function sessionStudent(r: Req): string {
  const session = r.actor.session
  if (!session || session.kind !== 'student_session') throw new HttpError('unauthorized', 'Student session required.')
  return session.studentId
}

/** Student mode, insight views, proficiency and Progress Drafts (milestone M3). */
export function progressRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req, sessionDeps } = kit

  // ---------- student mode: never returns IEP text (PRD "Roles and modes") ----------

  /** A teacher or EA starts the session; parental consent is checked in the room first (PRD NFR Consent). */
  app.post('/students/:id/sessions', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    await r.student(studentId, sessionsStart)
    return r.json(SessionCreateResponse, await startStudentSession(sessionDeps, r.env, r.actor, studentId), 201)
  })

  app.get('/sessions/:sid/next', mw.studentSessionAuth(), async (c) => {
    const r = req(c)
    return r.json(SessionNextResponse, await r.student(sessionStudent(r), sessionsNext))
  })

  /** Objective items are scored against the key in code, never by the model. */
  app.post('/sessions/:sid/responses', mw.studentSessionAuth(), async (c) => {
    const r = req(c)
    const body = await r.body(SessionResponseBody)
    return r.json(SessionResponseResult, await r.student(sessionStudent(r), sessionsRespond, body), 201)
  })

  app.get('/sessions/:sid/progress', mw.studentSessionAuth(), async (c) => {
    const r = req(c)
    return r.json(SessionProgressResponse, await r.student(sessionStudent(r), sessionsProgress))
  })

  // ---------- insight ----------

  app.get('/students/:id/goals/:gid/aimline', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(AimlineResponse, await r.student(r.param('id'), aimlineGet, { goalId: r.param('gid') }))
  })

  app.get('/students/:id/what-works', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(WhatWorksResponse, await r.student(r.param('id'), whatWorksGet))
  })

  // ---------- proficiency and Progress Drafts ----------

  app.post('/goals/:gid/proficiency', signedIn, studentRef, mw.requireCapability('proficiency.set'), async (c) => {
    const r = req(c)
    const body = await r.body(ProficiencySetBody)
    return r.json(ProficiencyResponse, await r.student(r.studentRef(), proficiencySet, { goalId: r.param('gid'), ...body }), 201)
  })

  /**
   * PRD Progress Drafts: the AI drafts from confirmed points only; every cited
   * id is checked in code and a draft with an invalid or foreign citation is
   * rejected. BC reporting rules (IE, "in relation to IEP goals") are applied after.
   */
  app.post('/students/:id/drafts', signedIn, mw.requireCapability('draft.edit'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(DraftCreateBody)
    const ctx = await r.student(studentId, draftsContext, { goalId: body.goalId, period: body.period })
    const { token } = await studentToken(r, studentId)
    const ai = await r.ai([studentId])
    const out = await ai.draftProgress({ studentToken: token, ...ctx })
    const known = ctx.dataPoints.map((p) => ({ id: p.id, studentId, status: 'confirmed' as const }))
    const check = checkCitations(out, known, studentId)
    if (!check.ok) {
      const detail = check.problems.map((p) => `sentence ${p.sentenceIndex}: ${p.dataPointId} ${p.reason}`).join('; ')
      throw new HttpError('bad_request', `Draft rejected: invalid citation (${detail}).`)
    }
    let { draft } = await r.student(studentId, draftsSave, {
      goalId: body.goalId,
      period: body.period,
      dueDate: body.dueDate,
      sentences: out.sentences,
      citationCheck: { valid: true, errors: [] },
    })
    const corrected = applyReportingRules(
      { sentences: draft.sentences, proficiencySuggestion: draft.proficiencySuggestion },
      { insufficientEvidence: draft.proficiencySuggestion === 'IE' },
    )
    // Reporting statements carry no citations, so they are added as an edit after the cited draft is stored.
    if (corrected.sentences.length !== draft.sentences.length) {
      draft = (await r.student(studentId, draftsUpdate, { draftId: draft.id, expectedVersion: draft.version, sentences: corrected.sentences })).draft
    }
    return r.json(DraftResponse, { draft }, 201)
  })

  app.patch('/drafts/:did', signedIn, studentRef, mw.requireCapability('draft.edit'), async (c) => {
    const r = req(c)
    const body = await r.body(DraftPatchBody)
    return r.json(DraftResponse, await r.student(r.studentRef(), draftsUpdate, { draftId: r.param('did'), ...body }))
  })

  app.post('/drafts/:did/mark-used', signedIn, studentRef, mw.requireCapability('draft.edit'), async (c) => {
    const r = req(c)
    const body = await r.body(DraftMarkUsedBody)
    return r.json(DraftResponse, await r.student(r.studentRef(), draftsMarkUsed, { draftId: r.param('did'), ...body }))
  })
}
