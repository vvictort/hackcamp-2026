import type { Hono } from 'hono'
import { z } from 'zod'
import { routeScore } from '../ai/scoring'
import {
  CaptureBatchResponse,
  CaptureEventBody,
  CaptureEventResponse,
  DataPointCorrectBody,
  DataPointResponse,
  DataPointSourceResponse,
  GoalStatusResponse,
  NoteBody,
  NoteResponse,
  PhotoCaptureBody,
  ReviewConfirmBody,
  ReviewQueueResponse,
  TimelineQuery,
  TimelineResponse,
  VideoBody,
  VideoResponse,
  VoiceNoteBody,
  VoiceNoteResponse,
} from '../contract/api'
import { Id, type MediaRef } from '../contract/common'
import { AltamyraError } from '../contract/errors'
import type { CapturePageResult } from '../contract/school'
import type { Check } from '../contract/student'
import type { AltamyraEnv } from '../middleware/auth'
import { HttpError } from '../middleware/errors'
import { captureBatchesCreate, captureBatchesGet, checksForScoring } from '../services/integration'
import { notesAdd, videosAdd } from '../services/day-record'
import { lensSaveRun } from '../services/lens'
import { ensureReviewable, fallbackPageScore, type PageItemScore } from '../services/scoring'
import { voiceNoteAudioDeleted, voiceNoteProcess } from '../services/family'
import {
  dataPointSource,
  dataPointsAddPending,
  dataPointsCorrect,
  eventsRecord,
  goalStatusGet,
  objectivesForCapture,
  objectivesList,
  reviewConfirm,
  reviewList,
  timelineGet,
  type Routing,
} from '../services/measurement'
import { classesList, lessonsCreate, rosterList, sheetCodesIssue, sheetCodesResolve } from '../services/school'
import { photoRef } from '../services/sources'
import type { Kit, Req } from './context'
import { studentToken } from './student-flows'

const CaptureObjectivesResponse = z.object({
  objectives: z.array(z.object({ objectiveId: Id, metricType: z.string(), unit: z.string() })),
})
const SampleSheetBody = z.object({ studentId: Id })
const SampleSheetResponse = z.object({ code: z.string(), studentId: Id, checkId: Id })

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

type ResolvedPage = {
  page: MediaRef
  code: string | null
  sheet: { studentId: string; lessonId: string; checkId: string; classId: string | null } | null
}

const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
/** Decoded size cap per photographed page (inline base64 travels in the JSON body and in the Gemini request). */
export const MAX_PHOTO_BYTES = 7 * 1024 * 1024

/**
 * Normalises one photographed page for the model: base MIME type (no
 * parameters, jpg alias), no data: URL prefix or whitespace in the base64,
 * and a type and size check so a bad upload is a clear 400, not a model error.
 */
export function normalizePhotoPage(page: MediaRef): MediaRef {
  const contentType = (page.contentType.split(';')[0] ?? '').trim().toLowerCase().replace('image/jpg', 'image/jpeg')
  if (!PHOTO_TYPES.has(contentType)) throw new HttpError('bad_request', 'Photos must be PNG, JPEG, WebP or HEIC images.')
  if (page.bytesBase64 === undefined) return { ...page, contentType }
  const bytesBase64 = page.bytesBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(bytesBase64)) throw new HttpError('bad_request', 'The photo is not valid base64.')
  if ((bytesBase64.length * 3) / 4 > MAX_PHOTO_BYTES) throw new HttpError('bad_request', 'A photo must be 7 MB or smaller.')
  return { ...page, contentType, bytesBase64 }
}

async function resolvePages(r: Req, rawPages: MediaRef[]): Promise<ResolvedPage[]> {
  const out: ResolvedPage[] = []
  for (const page of rawPages.map(normalizePhotoPage)) {
    const code = r.deps.readSheetCode(page)
    if (!code) {
      out.push({ page, code: null, sheet: null })
      continue
    }
    try {
      const { sheetCode, classId } = await r.school(sheetCodesResolve, { code })
      out.push({ page, code, sheet: { ...sheetCode, classId } })
    } catch (err) {
      // An unknown code is an unreadable page; a student outside the caller's scope refuses the whole batch.
      if (err instanceof AltamyraError && err.code === 'not_found') out.push({ page, code, sheet: null })
      else throw err
    }
  }
  return out
}

/** Demo sheets (file key "sample-sheet-code-...") are only recognised when the dev seed is on. */
/** An upload key must stay inside the caller's own upload scope: no absolute paths, traversal or odd characters. */
function assertUploadKey(key: string): void {
  if (key.startsWith('/') || key.includes('\\') || /[\u0000-\u001f]/.test(key) || key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new HttpError('bad_request', 'That file location is not valid. Upload the file again.')
  }
}

/** No-consent cleanup: a failed delete is logged and never changes the 403 the caller gets. */
async function deleteQuietly(r: Req, fileKey: string, afterDelete?: () => Promise<unknown>): Promise<void> {
  try {
    await r.deps.deleteFile(r.env, fileKey, r.actor.userId)
    await afterDelete?.()
  } catch (err) {
    console.error('altamyra: consent-refused upload could not be deleted', { fileKey, reason: err instanceof Error ? err.message : String(err) })
  }
}

const isSampleSheet = (r: Req, page: MediaRef) => r.deps.devSeedEnabled(r.env) && /sample-sheet-code/i.test(page.fileKey)

/**
 * The AI scores the page. With no key or any AI failure, a deterministic
 * fallback keeps the demo flow working; it always leaves one low-confidence
 * item so the review queue is exercised. Real photos are never auto-trusted
 * by the fallback.
 */
async function scoreItems(r: Req, studentId: string, page: MediaRef, check: Check): Promise<PageItemScore[]> {
  let items: PageItemScore[]
  try {
    const ai = await r.ai([studentId])
    const scored = await ai.scorePhotoPage({
      image: page,
      check: { checkId: check.id, items: check.items, answerKey: check.answerKey, rubric: check.rubric },
    })
    items = scored.items
  } catch (err) {
    if (err instanceof AltamyraError && err.code === 'forbidden') throw err
    items = fallbackPageScore(check.items, check.rubric ? Math.max(...check.rubric.levels.map((l) => l.score)) : null)
  }
  return isSampleSheet(r, page) ? ensureReviewable(items, AI_CONFIDENCE_THRESHOLD) : items
}

async function scorePage(r: Req, p: ResolvedPage): Promise<CapturePageResult> {
  const base = { fileKey: p.page.fileKey, sheetCode: p.code, studentId: p.sheet?.studentId ?? null }
  if (!p.sheet) return { ...base, status: 'unreadable_code', dataPointIds: [] }
  const { studentId, lessonId, checkId, classId } = p.sheet
  try {
    const { check } = await r.student(studentId, checksForScoring, { checkId })
    const scoredItems = await scoreItems(r, studentId, p.page, check)
    const { value, confidence } = pageScore(check, scoredItems)
    // PRD data quality: the point links to its photo and item; the item is the page's least confident one.
    const weakest = scoredItems.reduce<PageItemScore | null>((w, i) => (!w || i.confidence < w.confidence ? i : w), null)
    const { dataPoint } = await r.student(studentId, dataPointsAddPending, {
      objectiveId: check.objectiveId,
      value,
      aiConfidence: confidence,
      routing: routing(confidence, r.sampleSeed(), check.rubric !== null),
      sourceRef: photoRef(p.page.fileKey, weakest?.itemId ?? null),
      lessonId,
      classId,
    })
    return { ...base, status: 'scored', dataPointIds: [dataPoint.id] }
  } catch (err) {
    if (err instanceof AltamyraError && err.code !== 'forbidden') return { ...base, status: 'failed', dataPointIds: [] }
    throw err
  }
}

/** Photo capture, EA events and voice notes, review queue, corrections and timeline (feature 1B, M2). */
export function captureRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
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

  /**
   * Goals an EA (or any staff role) can record against: ids, metric types and
   * units only, no IEP wording. GET /students/:id/objectives stays for the
   * case manager and teachers.
   */
  app.get('/students/:id/capture-objectives', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    return r.json(CaptureObjectivesResponse, await r.student(r.param('id'), objectivesForCapture))
  })

  /** Whether the family allows voice notes and videos, so the capture screen can show the state before anything is recorded. */
  app.get('/students/:id/capture-consent', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const room = deps.rooms.student(r.env, r.param('id'))
    return r.json(z.object({ voiceNote: z.boolean(), video: z.boolean() }), {
      voiceNote: await room.hasConsent('voice_note'),
      video: await room.hasConsent('video'),
    })
  })

  /**
   * Demo only (ALTAMYRA_DEV_SEED): builds a lesson with one keyed check for the
   * student's confirmed goal and issues its sheet code, so the bundled fictional
   * sample sheet can be photographed and scored without the Lesson Lens first.
   */
  app.post('/captures/sample-sheet', signedIn, async (c) => {
    const r = req(c)
    if (!deps.devSeedEnabled(r.env)) throw new HttpError('not_found', 'not found')
    const { studentId } = await r.body(SampleSheetBody)
    r.allow('lesson_plan.edit', studentId)
    const { objectives } = await r.student(studentId, objectivesList)
    const confirmed = objectives.filter((o) => o.status === 'confirmed')
    const objective = confirmed.find((o) => o.metricType === 'accuracy') ?? confirmed[0]
    if (!objective) throw new HttpError('bad_request', 'This student has no confirmed goal to score against.')
    let classId: string | null = null
    for (const cls of (await r.school(classesList)).classes) {
      if ((await r.school(rosterList, { classId: cls.id })).studentIds.includes(studentId)) {
        classId = cls.id
        break
      }
    }
    if (!classId) throw new HttpError('bad_request', 'This student is not on a class roster.')
    const { lesson } = await r.school(lessonsCreate, {
      classId,
      title: 'Sample sheet: number facts',
      sourceKind: 'text',
      text: 'Add and subtract within 10. Compare two numbers.',
    })
    const run = await r.student(studentId, lensSaveRun, {
      lessonId: lesson.id,
      analysisId: crypto.randomUUID(),
      subject: 'math',
      gaps: [],
      adaptations: [
        {
          adaptationType: 'visual_supports',
          title: 'Number line on the desk',
          text: 'Keep a number line on the desk for adding and subtracting.',
          why: 'Supports counting on and back.',
          goalIds: [objective.goalId],
          changesOutcome: false,
          modelLabel: 'adaptation',
          label: 'adaptation',
        },
      ],
      checks: [
        {
          goalId: objective.goalId,
          objectiveId: objective.id,
          items: [
            { id: 'q1', prompt: '4 + 3 = ?', format: 'numeric', options: null },
            { id: 'q2', prompt: '9 - 4 = ?', format: 'numeric', options: null },
            { id: 'q3', prompt: 'Which is bigger, 6 or 8?', format: 'multiple_choice', options: ['6', '8'] },
          ],
          answerKey: [
            { itemId: 'q1', accepted: ['7'] },
            { itemId: 'q2', accepted: ['5'] },
            { itemId: 'q3', accepted: ['8'] },
          ],
          rubric: null,
        },
      ],
    })
    const check = run.checks[0]
    if (!check) throw new HttpError('bad_request', 'The sample check could not be created.')
    const { sheetCode } = await r.school(sheetCodesIssue, { studentId, lessonId: lesson.id, checkId: check.id })
    return r.json(SampleSheetResponse, { code: sheetCode.code, studentId, checkId: check.id })
  })

  app.post('/students/:id/events', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const event = await r.body(CaptureEventBody)
    return r.json(CaptureEventResponse, await r.student(r.param('id'), eventsRecord, { event }), 201)
  })

  /**
   * PRD NFR Consent: a voice note needs the parent's voice-note consent (403 consent_required), and the recording is
   * deleted once the consent gate is passed, whether processing succeeds or
   * fails (or at once, unprocessed, without consent). The deletion is audited
   * only after the delete succeeded.
   */
  app.post('/students/:id/voice-notes', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(VoiceNoteBody)
    const audioFileKey = body.audio.fileKey
    assertUploadKey(audioFileKey)
    const deleteAudio = async (processed: boolean) => {
      await deps.deleteFile(r.env, audioFileKey, r.actor.userId)
      await r.student(studentId, voiceNoteAudioDeleted, { audioFileKey, processed })
    }
    if (!(await deps.rooms.student(r.env, studentId).hasConsent('voice_note'))) {
      await deleteQuietly(r, audioFileKey, () => r.student(studentId, voiceNoteAudioDeleted, { audioFileKey, processed: false }))
      throw new HttpError('forbidden', 'consent_required: voice notes need the parent or guardian\'s consent.')
    }
    let processed = false
    try {
      // Confirmed objectives only, as ids, metric types and units: no IEP text reaches the EA's request.
      const { objectives } = await r.student(studentId, objectivesForCapture)
      const { token } = await studentToken(r, studentId)
      const ai = await r.ai([studentId])
      const parsed = await ai.parseVoiceNote({
        audio: body.audio,
        studentToken: token,
        objectives: objectives.map((o) => ({ objectiveId: o.objectiveId, metricType: o.metricType, description: o.unit })),
      })
      const result = await r.student(studentId, voiceNoteProcess, {
        audioFileKey,
        classId: body.classId,
        recordedAt: body.recordedAt,
        events: parsed.events.map((event) => ({ event, routing: routing(event.confidence, r.sampleSeed()) })),
      })
      processed = true
      await deleteAudio(true)
      return r.json(VoiceNoteResponse, { dataPoints: result.dataPoints, audioDeleted: true }, 201)
    } finally {
      if (!processed) await deleteAudio(false)
    }
  })

  /** A typed observation, optionally tied to a goal; saved to today's record. */
  app.post('/students/:id/notes', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const body = await r.body(NoteBody)
    return r.json(NoteResponse, await r.student(r.param('id'), notesAdd, { objectiveId: body.objectiveId ?? null, text: body.text }), 201)
  })

  /**
   * A video upload (stored, not converted). Needs the parent's video consent: without it the answer is 403
   * "consent_required" and the uploaded file is deleted at once.
   */
  app.post('/students/:id/videos', signedIn, mw.requireCapability('evidence.capture'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(VideoBody)
    assertUploadKey(body.fileKey)
    if (!(await deps.rooms.student(r.env, studentId).hasConsent('video'))) {
      await deleteQuietly(r, body.fileKey)
      throw new HttpError('forbidden', "consent_required: videos need the parent or guardian's consent.")
    }
    const { video } = await r.student(studentId, videosAdd, {
      storageKey: body.fileKey,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      objectiveId: body.objectiveId ?? null,
      recordedAt: body.recordedAt,
    })
    return r.json(VideoResponse, { video }, 201)
  })

  /** Open review items across the caller's students: the EA and the teacher see their own captures only. */
  app.get('/review-queue', signedIn, async (c) => {
    const r = req(c)
    const only = c.req.query('studentId')
    const reviewable = r.staffStudentIds().filter((id) => r.can('review.confirm', id, { recordedBy: r.actor.userId }))
    // Case managers, parents and everyone else without an EA or teacher role are refused outright.
    if (reviewable.length === 0) throw new HttpError('forbidden', 'Only the EA or teacher who captured an entry reviews it.')
    const items = []
    for (const studentId of reviewable) {
      if (only && only !== studentId) continue
      items.push(...(await r.student(studentId, reviewList)).items)
    }
    return r.json(ReviewQueueResponse, { items })
  })

  app.post('/review-queue/:rid/confirm', signedIn, studentRef, async (c) => {
    const r = req(c)
    const studentId = r.studentRef()
    // Own captures only; the room checks the row's recorder.
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
