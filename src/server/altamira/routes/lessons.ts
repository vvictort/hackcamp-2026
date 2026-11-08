import type { Hono } from 'hono'
import {
  BulkApproveBody,
  BulkApproveResponse,
  CheckRemoveBody,
  CheckResponse,
  LensRunBody,
  LensRunResponse,
  LensStudentResponse,
  LessonAnalysisResponse,
  LessonCreateBody,
  LessonResponse,
  SheetResponse,
  SuggestionApproveBody,
  SuggestionEditBody,
  SuggestionRegenerateBody,
  SuggestionRejectBody,
  SuggestionResponse,
  type LensStudentResult,
} from '../contract/api'
import { classifyAdaptation } from '../ai/guardrail'
import { AltamiraError } from '../contract/errors'
import type { AdaptationSuggestion } from '../contract/student'
import type { AltamiraEnv } from '../middleware/auth'
import { HttpError } from '../middleware/errors'
import { suggestionsContext } from '../services/integration'
import {
  checksRemove,
  lensGet,
  suggestionsApprove,
  suggestionsBulkApprove,
  suggestionsEdit,
  suggestionsRegenerate,
  suggestionsReject,
} from '../services/lens'
import { lessonsCreate, sheetCodesIssue } from '../services/school'
import type { Kit } from './context'
import { ensureAnalysis, labelAdaptation, lensInput, loadLesson, runLensForStudent, studentToken } from './lens-flow'

/** Bytes of an inline base64 upload (0 when the file is only referenced). */
const base64Size = (b64: string | undefined) => (b64 ? Math.floor((b64.replace(/=+$/, '').length * 3) / 4) : 0)

/** Lessons, lens, suggestions and printable sheets (feature 1A, milestone M1). */
export function lessonRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req } = kit

  /**
   * PRD 1A-1: the lesson arrives as text or as a file. The file travels as a
   * MediaRef (bytes inline as base64, or a key already in app storage); only
   * the reference is stored here.
   */
  app.post('/classes/:cid/lessons', signedIn, async (c) => {
    const r = req(c)
    const body = await r.body(LessonCreateBody)
    const { lesson } = await r.school(lessonsCreate, { classId: r.param('cid'), ...body, sizeBytes: base64Size(body.file?.bytesBase64) })
    // Analyse now, while inline bytes are at hand; later requests reuse the cached analysis (PRD 1A-2).
    const info = await loadLesson(r, lesson.id)
    await ensureAnalysis(r, info, await r.ai(info.studentIds), body.file)
    return r.json(LessonResponse, { lesson }, 201)
  })

  app.get('/lessons/:lid/analysis', signedIn, async (c) => {
    const r = req(c)
    const info = await loadLesson(r, r.param('lid'))
    return r.json(LessonAnalysisResponse, { analysis: await ensureAnalysis(r, info, await r.ai(info.studentIds)) })
  })

  /** Runs the lens for every IEP student in the class (or the listed ones) against one cached analysis. */
  app.post('/lessons/:lid/lens', signedIn, async (c) => {
    const r = req(c)
    const body = await r.body(LensRunBody)
    const info = await loadLesson(r, r.param('lid'))
    const explicit = body.studentIds !== undefined
    const targets = body.studentIds ?? info.studentIds.filter((id) => r.can('lesson.augment', id))
    if (explicit) {
      for (const id of targets) {
        if (!info.studentIds.includes(id)) throw new HttpError('bad_request', 'student is not on this class roster')
        r.allow('lesson.augment', id)
      }
    }
    // Every roster student is on the de-identification roster: lesson text may name any of them.
    const ai = await r.ai(info.studentIds)
    const analysis = await ensureAnalysis(r, info, ai)
    const results: LensStudentResult[] = []
    for (const studentId of targets) {
      try {
        results.push(await runLensForStudent(r, ai, info, analysis, studentId))
      } catch (err) {
        // A roster student without a confirmed IEP is skipped when the class is run as a whole.
        if (!explicit && err instanceof AltamiraError && err.code === 'not_found') continue
        throw err
      }
    }
    return r.json(LensRunResponse, { analysisId: analysis.id, results })
  })

  app.get('/lessons/:lid/lens/:sid', signedIn, mw.requireCapability('lesson.augment', 'sid', () => ({ access: 'read' })), async (c) => {
    const r = req(c)
    const result = await r.student(r.param('sid'), lensGet, { lessonId: r.param('lid') })
    if (!result) throw new HttpError('not_found', 'no lens run for this student and lesson')
    return r.json(LensStudentResponse, result)
  })

  // ---------- suggestions (PRD 1A-7: approve writes the usage event in the same transaction) ----------

  app.post('/suggestions/:sgid/approve', signedIn, studentRef, mw.requireCapability('adaptation.approve'), async (c) => {
    const r = req(c)
    const body = await r.body(SuggestionApproveBody)
    return r.json(SuggestionResponse, await r.student(r.studentRef(), suggestionsApprove, { suggestionId: r.param('sgid'), ...body }))
  })

  /**
   * PRD 1A-5: an edit is labelled again in code. Edited text that changes the
   * learning outcome becomes a modification, blocked unless the IEP authorizes it.
   */
  app.post('/suggestions/:sgid/edit', signedIn, studentRef, mw.requireCapability('adaptation.approve'), async (c) => {
    const r = req(c)
    const studentId = r.studentRef()
    const body = await r.body(SuggestionEditBody)
    const { suggestion, lessonId } = await r.student(studentId, suggestionsContext, { suggestionId: r.param('sgid') })
    if (suggestion.kind !== 'adaptation') throw new HttpError('bad_request', 'only adaptations can be edited')
    const info = await loadLesson(r, lessonId)
    const analysis = await ensureAnalysis(r, info, await r.ai(info.studentIds))
    const content = { ...suggestion.content, ...body.content }
    const { label } = classifyAdaptation(
      { adaptationType: suggestion.adaptationType, title: content.title, text: content.text, changesOutcome: content.changesOutcome, subject: content.subject },
      analysis.analysis,
      // The room applies the IEP's modification subjects when it stores the label.
      { modificationSubjects: [] },
    )
    return r.json(SuggestionResponse, await r.student(studentId, suggestionsEdit, { suggestionId: suggestion.id, ...body, label }))
  })

  /** PRD 1A-6: checks are generated by default; the teacher can remove them. */
  app.post('/checks/:chid/remove', signedIn, studentRef, mw.requireCapability('lesson.augment'), async (c) => {
    const r = req(c)
    const body = await r.body(CheckRemoveBody)
    return r.json(CheckResponse, await r.student(r.studentRef(), checksRemove, { checkId: r.param('chid'), ...body }))
  })

  app.post('/suggestions/:sgid/reject', signedIn, studentRef, mw.requireCapability('adaptation.approve'), async (c) => {
    const r = req(c)
    const body = await r.body(SuggestionRejectBody)
    return r.json(SuggestionResponse, await r.student(r.studentRef(), suggestionsReject, { suggestionId: r.param('sgid'), ...body }))
  })

  /**
   * Asks the lens again for this student and lesson and swaps in a different
   * adaptation for the same goal. The guardrail labels it in code (PRD 1A-5).
   */
  app.post('/suggestions/:sgid/regenerate', signedIn, studentRef, mw.requireCapability('adaptation.approve'), async (c) => {
    const r = req(c)
    const studentId = r.studentRef()
    const body = await r.body(SuggestionRegenerateBody)
    const { suggestion, lessonId } = await r.student(studentId, suggestionsContext, { suggestionId: r.param('sgid') })
    if (suggestion.kind !== 'adaptation') throw new HttpError('bad_request', 'only adaptations can be regenerated')
    const info = await loadLesson(r, lessonId)
    const ai = await r.ai(info.studentIds)
    const analysis = await ensureAnalysis(r, info, ai)
    const ctx = await lensInput(r, studentId)
    const out = await ai.lensForStudent({
      lessonId,
      subject: info.subject,
      analysis: analysis.analysis,
      lessonText: info.lesson.text,
      profile: ctx.profile,
      whatWorks: ctx.whatWorks,
    })
    const sameGoal = out.adaptations.filter((a) => a.goalIds.some((g) => suggestion.goalIds.includes(g)))
    const pick = sameGoal.find((a) => a.title !== suggestion.content.title) ?? sameGoal[0] ?? out.adaptations[0]
    if (!pick) throw new HttpError('not_found', 'the lens returned no adaptation to swap in')
    const adaptation = labelAdaptation(pick, info.subject, analysis, ctx.profile.modificationSubjects)
    return r.json(
      SuggestionResponse,
      await r.student(studentId, suggestionsRegenerate, { suggestionId: suggestion.id, expectedVersion: body.expectedVersion, adaptation }),
    )
  })

  app.post('/students/:id/suggestions/bulk-approve', signedIn, mw.requireCapability('adaptation.approve'), async (c) => {
    const r = req(c)
    const body = await r.body(BulkApproveBody)
    return r.json(BulkApproveResponse, await r.student(r.param('id'), suggestionsBulkApprove, body))
  })

  /**
   * Printable payload: one coded page per check on the approved adaptations.
   * Codes carry no names (PRD principle 3); the answer key prints separately.
   */
  app.get('/lessons/:lid/sheets/:sid', signedIn, mw.requireCapability('lesson.augment', 'sid', () => ({ access: 'read' })), async (c) => {
    const r = req(c)
    const lessonId = r.param('lid')
    const studentId = r.param('sid')
    const result = await r.student(studentId, lensGet, { lessonId })
    if (!result) throw new HttpError('not_found', 'no lens run for this student and lesson')
    const approved = result.suggestions.filter((s): s is AdaptationSuggestion => s.kind === 'adaptation' && s.status === 'approved')
    const approvedIds = new Set(approved.map((s) => s.id))
    const adaptations = approved.map((s) => ({ suggestionId: s.id, title: s.content.title, text: s.content.text }))
    const checks = result.checks.filter((ch) => ch.status === 'active' && approvedIds.has(ch.suggestionId))
    const { token } = await studentToken(r, studentId)
    const pages = []
    const answerKey = []
    for (const check of checks) {
      const { sheetCode } = await r.school(sheetCodesIssue, { studentId, lessonId, checkId: check.id })
      pages.push({ sheetCode: sheetCode.code, studentToken: token, adaptations, checkItems: check.items })
      answerKey.push({ sheetCode: sheetCode.code, entries: check.answerKey ?? [] })
    }
    return r.json(SheetResponse, { lessonId, pages, answerKey })
  })
}
