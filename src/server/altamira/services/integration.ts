import { z } from 'zod'
import { DateString, Id } from '../contract/common'
import { CaptureBatchStatus } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { CapturePageResult, type CaptureBatch } from '../contract/school'
import { Check, LensRun, type Suggestion } from '../contract/student'
import { audit, findById, insertEntity, newId, nowIso } from '../repos/base'
import * as lens from '../repos/lens'
import * as repo from '../repos/school'
import { Now, StudentArgs, authorize, authorizeStaff } from './authz'

/**
 * Ops the /api/v1 router needs to connect the pieces: photo capture batches
 * (school room), the lesson behind a suggestion (student room, for
 * regenerate) and today's lessons and schedule for the Today View.
 */

const weekdayOf = (date: string) => new Date(`${date}T12:00:00.000Z`).getUTCDay()

// ---------- photo capture batches (POST /captures/photos, GET /captures/:batchId) ----------

export const captureBatchesCreate = defineOp({
  name: 'captureBatches.create',
  room: 'school',
  capability: 'evidence.capture',
  args: z.object({ pages: z.array(CapturePageResult).min(1), status: CaptureBatchStatus }).extend(Now.shape),
  run(sql, args, actor): { batch: CaptureBatch } {
    for (const page of args.pages) if (page.studentId) authorizeStaff(actor, 'evidence.capture', page.studentId)
    const at = nowIso(args.now)
    const batch: CaptureBatch = { id: newId(), createdBy: actor.userId, createdAt: at, status: args.status, pages: args.pages, version: 1 }
    insertEntity(sql, 'capture_batches', batch)
    audit(sql, actor, 'capture_batches.create', 'capture_batches', batch.id, undefined, { status: batch.status, pages: batch.pages.length }, at)
    return { batch }
  },
})

/** A batch is shown only to the person who captured it; anyone else gets 404. */
export const captureBatchesGet = defineOp({
  name: 'captureBatches.get',
  room: 'school',
  capability: 'evidence.capture',
  args: z.object({ batchId: Id }),
  run(sql, args, actor): { batch: CaptureBatch } {
    const batch = repo.captureBatchById(sql, args.batchId)
    if (!batch || actor.session || batch.createdBy !== actor.userId) throw new AltamiraError('not_found', `capture batch ${args.batchId} not found`)
    return { batch }
  },
})

// ---------- the lesson behind a suggestion (POST /suggestions/:sgid/regenerate) ----------

export const suggestionsContext = defineOp({
  name: 'suggestions.context',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({ suggestionId: Id }),
  run(sql, args, actor): { suggestion: Suggestion; lessonId: string } {
    authorize(actor, 'adaptation.approve', args.studentId)
    const suggestion = lens.suggestionById(sql, args.suggestionId)
    if (!suggestion) throw new AltamiraError('not_found', `suggestion ${args.suggestionId} not found`)
    const run = findById(sql, 'lens_runs', LensRun, suggestion.lensRunId)
    if (!run) throw new AltamiraError('not_found', `lens run ${suggestion.lensRunId} not found`)
    return { suggestion, lessonId: run.lessonId }
  },
})

// ---------- the check behind a photographed sheet (POST /captures/photos) ----------

/** Full check with its answer key, for scoring a coded sheet. Staff who capture evidence only. */
export const checksForScoring = defineOp({
  name: 'checks.forScoring',
  room: 'student',
  capability: 'evidence.capture',
  args: StudentArgs.extend({ checkId: Id }),
  run(sql, args, actor): { check: Check } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const check = findById(sql, 'checks', Check, args.checkId)
    if (!check) throw new AltamiraError('not_found', `check ${args.checkId} not found`)
    return { check }
  },
})

// ---------- Today View: the student's lessons and schedule for one day ----------

export const todayViewSchedule = defineOp({
  name: 'todayView.schedule',
  room: 'school',
  capability: 'iep.view',
  args: StudentArgs.extend({ date: DateString }).extend(Now.shape),
  run(sql, args, actor) {
    authorize(actor, 'iep.view', args.studentId, { now: Date.parse(nowIso(args.now)) })
    const classIds = repo.classesOfStudent(sql, args.studentId)
    const lessons = classIds.flatMap((classId) => repo.lessonsOn(sql, classId, args.date)).map((l) => ({ lessonId: l.id, title: l.title }))
    const schedule = repo
      .blocksForWeekday(sql, weekdayOf(args.date))
      .filter((b) => classIds.includes(b.classId))
      .map((b) => ({ className: repo.classById(sql, b.classId)?.name ?? '', startsAt: b.startsAt, endsAt: b.endsAt }))
    return { lessons, schedule }
  },
})

export const integrationSchoolOps = [captureBatchesCreate, captureBatchesGet, todayViewSchedule]
export const integrationStudentOps = [suggestionsContext, checksForScoring]
