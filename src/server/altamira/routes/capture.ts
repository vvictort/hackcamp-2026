import type { Hono } from 'hono'
import { routeScore } from '../ai/scoring'
import {
  CaptureBatchResponse,
  CaptureEventBody,
  CaptureEventResponse,
  DataPointCorrectBody,
  DataPointResponse,
  DataPointSourceResponse,
  GoalStatusResponse,
  PhotoCaptureBody,
  ReviewConfirmBody,
  ReviewQueueResponse,
  TimelineQuery,
  TimelineResponse,
  VoiceNoteBody,
  VoiceNoteResponse,
} from '../contract/api'
import type { MediaRef } from '../contract/common'
import { AltamiraError } from '../contract/errors'
import type { CapturePageResult } from '../contract/school'
import type { Check } from '../contract/student'
import type { AltamiraEnv } from '../middleware/auth'
import { HttpError } from '../middleware/errors'
import { captureBatchesCreate, captureBatchesGet, checksForScoring } from '../services/integration'
import { voiceNoteProcess } from '../services/family'
import {
  dataPointSource,
  dataPointsAddPending,
  dataPointsCorrect,
  eventsRecord,
  goalStatusGet,
  objectivesList,
  reviewConfirm,
  reviewList,
  timelineGet,
  type Routing,
} from '../services/measurement'
import { sheetCodesResolve } from '../services/school'
import { photoRef } from '../services/sources'
import type { Kit, Req } from './context'
import { studentToken } from './lens-flow'

/**
 * Assumption: the PRD routes "scores below the threshold, and a random sample
 * of confident ones" to review without numbers. These are the starting values.
 */
export const AI_CONFIDENCE_THRESHOLD = 0.8
export const AI_REVIEW_SAMPLE_RATE = 0.1

/** PRD 1B: low confidence and a sample of confident scores go to review; rubric scores always do. */
function routing(confidence: number, seed: string, rubric = false): Routing {
  const r = routeScore({ confidence, threshold: AI_CONFIDENCE_THRESHOLD, sampleRate: AI_REVIEW_SAMPLE_RATE, seed, rubric, agreement: null })
  return r.status === 'pending_review' && r.reviewKind ? { status: 'pending_review', reviewKind: r.reviewKind } : { status: 'auto_confirmed', reviewKind: null }
}

/**
 * One data point per photographed page: percent correct for keyed checks,
 * mean level for rubric checks. The page's confidence is its least confident item.
 */
function pageScore(check: Check, items: { value: number; confidence: number }[]) {
  const n = Math.max(items.length, 1)
  const sum = items.reduce((s, i) => s + i.value, 0)
  const value = check.answerKey ? Math.round((sum / n) * 100) : sum / n
  const confidence = items.length ? Math.min(...items.map((i) => i.confidence)) : 0
  return { value, confidence }
}

type ResolvedPage = { page: MediaRef; code: string | null; sheet: { studentId: string; lessonId: string; checkId: string } | null }

async function resolvePages(r: Req, pages: MediaRef[]): Promise<ResolvedPage[]> {
  const out: ResolvedPage[] = []
  for (const page of pages) {
    const code = r.deps.readSheetCode(page)
    if (!code) {
      out.push({ page, code: null, sheet: null })
      continue
    }
    try {
      const { sheetCode } = await r.school(sheetCodesResolve, { code })
      out.push({ page, code, sheet: sheetCode })
    } catch (err) {
      // An unknown code is an unreadable page; a student outside the caller's scope refuses the whole batch.
      if (err instanceof AltamiraError && err.code === 'not_found') out.push({ page, code, sheet: null })
      else throw err
    }
  }
  return out
}

async function scorePage(r: Req, p: ResolvedPage): Promise<CapturePageResult> {
  const base = { fileKey: p.page.fileKey, sheetCode: p.code, studentId: p.sheet?.studentId ?? null }
  if (!p.sheet) return { ...base, status: 'unreadable_code', dataPointIds: [] }
  const { studentId, lessonId, checkId } = p.sheet
  try {
    const { check } = await r.student(studentId, checksForScoring, { checkId })
    const ai = await r.ai()
    const scored = await ai.scorePhotoPage({
      image: p.page,
      check: { checkId, items: check.items, answerKey: check.answerKey, rubric: check.rubric },
    })
    const { value, confidence } = pageScore(check, scored.items)
    const { dataPoint } = await r.student(studentId, dataPointsAddPending, {
      objectiveId: check.objectiveId,
      value,
      aiConfidence: confidence,
      routing: routing(confidence, `${p.page.fileKey}:${checkId}`, check.rubric !== null),
      sourceRef: photoRef(p.page.fileKey, null),
      lessonId,
    })
    return { ...base, status: 'scored', dataPointIds: [dataPoint.id] }
  } catch (err) {
    if (err instanceof AltamiraError && err.code !== 'forbidden') return { ...base, status: 'failed', dataPointIds: [] }
    throw err
  }
}

/** Photo capture, EA events and voice notes, review queue, corrections and timeline (feature 1B, M2). */
export function captureRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, studentRef, req, deps } = kit

  /**
   * PRD 1B "Photo in the web app": each page's sheet code names the student,
   * lesson and check. The AI scores the page; routing decides auto-confirm or review.
   */
  app.post('/captures/photos', signedIn, async (c) => {
    const r = req(c)
    const body = await r.body(PhotoCaptureBody)
    const resolved = await resolvePages(r, body.pages)
    for (const p of resolved) if (p.sheet) r.allow('evidence.capture', p.sheet.studentId)
    const pages: CapturePageResult[] = []
    for (const p of resolved) pages.push(await scorePage(r, p))
    const status = pages.some((p) => p.status === 'scored') ? 'done' : 'failed'
    return r.json(CaptureBatchResponse, await r.school(captureBatchesCreate, { pages, status }), 201)
  })

  app.get('/captures/:batchId', signedIn, async (c) => {
    const r = req(c)
    return r.json(CaptureBatchResponse, await r.school(captureBatchesGet, { batchId: r.param('batchId') }))
  })

  app.post('/students/:id/events', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const event = await r.body(CaptureEventBody)
    return r.json(CaptureEventResponse, await r.student(r.param('id'), eventsRecord, { event }), 201)
  })

  /**
   * PRD NFR Consent: audio needs parental consent, and the recording is
   * deleted once converted to events (or at once, unprocessed, without consent).
   */
  app.post('/students/:id/voice-notes', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(VoiceNoteBody)
    if (!(await deps.rooms.student(r.env, studentId).hasConsent('audio'))) {
      await deps.deleteFile(r.env, body.audio.fileKey, r.actor.userId)
      throw new HttpError('forbidden', 'Voice notes need recorded parental consent for audio.')
    }
    const { objectives } = await r.student(studentId, objectivesList)
    const { token } = await studentToken(r, studentId)
    const ai = await r.ai()
    const parsed = await ai.parseVoiceNote({
      audio: body.audio,
      studentToken: token,
      objectives: objectives
        .filter((o) => o.status === 'confirmed')
        .map((o) => ({ objectiveId: o.id, metricType: o.metricType, description: `${o.unit}: ${o.masteryRule}` })),
    })
    const result = await r.student(studentId, voiceNoteProcess, {
      audioFileKey: body.audio.fileKey,
      classId: body.classId,
      recordedAt: body.recordedAt,
      events: parsed.events.map((event, i) => ({ event, routing: routing(event.confidence, `${body.audio.fileKey}:${i}`) })),
    })
    await deps.deleteFile(r.env, body.audio.fileKey, r.actor.userId)
    return r.json(VoiceNoteResponse, { dataPoints: result.dataPoints, audioDeleted: true }, 201)
  })

  /** Open review items across the caller's students (EAs see their own entries only). */
  app.get('/review-queue', signedIn, async (c) => {
    const r = req(c)
    const only = c.req.query('studentId')
    const items = []
    for (const studentId of r.staffStudentIds()) {
      if ((only && only !== studentId) || !r.can('review.confirm', studentId, { recordedBy: r.actor.userId })) continue
      items.push(...(await r.student(studentId, reviewList)).items)
    }
    return r.json(ReviewQueueResponse, { items })
  })

  app.post('/review-queue/:rid/confirm', signedIn, studentRef, async (c) => {
    const r = req(c)
    const studentId = r.studentRef()
    // EAs may confirm only their own entries; the room checks the row's recorder.
    r.allow('review.confirm', studentId, { recordedBy: r.actor.userId })
    const body = await r.body(ReviewConfirmBody)
    return r.json(DataPointResponse, await r.student(studentId, reviewConfirm, { reviewId: r.param('rid'), ...body }))
  })

  /** PRD 1B: a correction is a new version with a reason; a stale expectedVersion answers 409. */
  app.post('/data-points/:dpid/correct', signedIn, studentRef, async (c) => {
    const r = req(c)
    const studentId = r.studentRef()
    r.allow('review.confirm', studentId, { recordedBy: r.actor.userId })
    const body = await r.body(DataPointCorrectBody)
    return r.json(DataPointResponse, await r.student(studentId, dataPointsCorrect, { dataPointId: r.param('dpid'), ...body }))
  })

  app.get('/students/:id/timeline', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    const query = r.query(TimelineQuery)
    return r.json(TimelineResponse, await r.student(r.param('id'), timelineGet, query))
  })

  app.get('/students/:id/goals/:gid/status', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(GoalStatusResponse, await r.student(r.param('id'), goalStatusGet, { goalId: r.param('gid') }))
  })

  app.get('/data-points/:dpid/source', signedIn, studentRef, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(DataPointSourceResponse, await r.student(r.studentRef(), dataPointSource, { dataPointId: r.param('dpid') }))
  })

  /** Live timeline socket; the room sends data point ids only, clients refetch through the scoped API. */
  app.get('/students/:id/live', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    if (!deps.openLive) throw new HttpError('not_found', 'live timeline is not available')
    return deps.openLive(r.env, r.param('id'), c.req.raw)
  })
}
