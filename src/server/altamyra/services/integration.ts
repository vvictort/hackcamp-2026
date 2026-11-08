import { z } from 'zod'
import { Id } from '../contract/common'
import { CaptureBatchStatus } from '../contract/enums'
import { AltamyraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { CapturePageResult, type CaptureBatch } from '../contract/school'
import { Check } from '../contract/student'
import { audit, findById, insertEntity, newId, nowIso } from '../repos/base'
import * as repo from '../repos/school'
import { Now, StudentArgs, authorizeStaff } from './authz'

/**
 * Ops the /api/v1 router needs to connect the pieces: photo capture batches
 * (school room) and the check behind a photographed sheet (student room).
 */

// ---------- photo capture batches (POST /captures/photos, GET /captures/:batchId) ----------

export const captureBatchesCreate = defineOp({
  name: 'captureBatches.create',
  room: 'school',
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
  args: z.object({ batchId: Id }),
  run(sql, args, actor): { batch: CaptureBatch } {
    const batch = repo.captureBatchById(sql, args.batchId)
    if (!batch || batch.createdBy !== actor.userId) throw new AltamyraError('not_found', `capture batch ${args.batchId} not found`)
    return { batch }
  },
})

// ---------- the check behind a photographed sheet (POST /captures/photos) ----------

/** Full check with its answer key, for scoring a coded sheet. Staff who capture evidence only. */
export const checksForScoring = defineOp({
  name: 'checks.forScoring',
  room: 'student',
  args: StudentArgs.extend({ checkId: Id }),
  run(sql, args, actor): { check: Check } {
    authorizeStaff(actor, 'evidence.capture', args.studentId)
    const check = findById(sql, 'checks', Check, args.checkId)
    if (!check) throw new AltamyraError('not_found', `check ${args.checkId} not found`)
    return { check }
  },
})

export const integrationSchoolOps = [captureBatchesCreate, captureBatchesGet]
export const integrationStudentOps = [checksForScoring]
