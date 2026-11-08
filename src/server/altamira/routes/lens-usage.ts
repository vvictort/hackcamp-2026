import type { Hono } from 'hono'
import { z } from 'zod'
import { AdaptationType } from '../contract/enums'
import { Id } from '../contract/common'
import { CheckItem } from '../contract/student'
import type { AltamiraEnv } from '../middleware/auth'
import { lensLogApproval, lensUsageList } from '../services/lens'
import { lessonsCreate, lessonsGet, sheetCodesIssue, studentsGet } from '../services/school'
import type { Kit, Req } from './context'

/**
 * Lesson Lens dashboard flow, backend half (PRD 1A approval -> 1B). The page analyses a lesson itself
 * (src/actions/lesson-lens*.ts); when the teacher approves adaptations it posts them here:
 *   POST /lens/approvals           stores them as approved adaptations with usage events, creates the
 *                                  lesson record and one coded check sheet per goal (PRD 1A-7).
 *   GET  /students/:id/lens-usage  approved adaptations for the student's timeline and "used" counts.
 */

export const LensApprovalBody = z.object({
  studentId: Id,
  /** Reused for later approvals of the same analysis. */
  lessonId: Id.optional(),
  classId: Id.optional(),
  lessonText: z.string().max(12_000).default(''),
  subject: z.string().min(1).max(80),
  items: z
    .array(
      z.object({
        goalId: Id,
        label: z.enum(['adapt', 'modify']),
        adaptationType: AdaptationType,
        title: z.string().min(1).max(120),
        text: z.string().min(1).max(600),
        why: z.string().max(600).default(''),
      }),
    )
    .min(1)
    .max(20),
  /** Checks to turn into coded sheets: one per goal, not repeated for goals that already have one. */
  checks: z.array(z.object({ goalId: Id, items: z.array(CheckItem).min(1).max(3) })).max(10).default([]),
})

export const LensApprovalResponse = z.object({
  /** Null when nothing could be stored (every item was refused). */
  lessonId: Id.nullable(),
  suggestions: z.array(z.object({ id: Id, goalId: Id })),
  /** One coded sheet per goal check; sheetCode is null when the lesson has no class record. */
  sheets: z.array(z.object({ goalId: Id, checkId: Id, sheetCode: z.string().nullable() })),
  /** Goal ids whose modification the IEP does not authorize. */
  blocked: z.array(Id),
})

export const LensUsageResponse = z.object({
  events: z.array(
    z.object({
      suggestionId: Id,
      at: z.string(),
      label: z.enum(['adaptation', 'modification']).nullable(),
      adaptationType: AdaptationType.nullable(),
      title: z.string(),
      text: z.string(),
      goalIds: z.array(Id),
    }),
  ),
  used: z.array(z.object({ adaptationType: AdaptationType, n: z.number().int() })),
})

/** The lesson row sheets hang on: reuse a known one, else create one in the student's class. */
async function ensureLesson(r: Req, body: z.output<typeof LensApprovalBody>): Promise<{ lessonId: string; real: boolean }> {
  if (body.lessonId) {
    try {
      await r.school(lessonsGet, { lessonId: body.lessonId })
      return { lessonId: body.lessonId, real: true }
    } catch {
      return { lessonId: body.lessonId, real: false }
    }
  }
  try {
    const classId = body.classId ?? (await r.school(studentsGet, { studentId: body.studentId })).classIds[0]
    if (classId) {
      const title = (body.lessonText.trim().split('\n')[0] || body.subject).slice(0, 80)
      const { lesson } = await r.school(lessonsCreate, { classId, title, sourceKind: 'text', text: body.lessonText.trim() || title })
      return { lessonId: lesson.id, real: true }
    }
  } catch {
    // The caller may not write to this class; usage is still logged, just without sheets.
  }
  return { lessonId: crypto.randomUUID(), real: false }
}

export function lensUsageRoutes(app: Hono<AltamiraEnv>, kit: Kit): void {
  const { mw, signedIn, req } = kit

  app.post('/lens/approvals', signedIn, async (c) => {
    const r = req(c)
    const body = await r.body(LensApprovalBody)
    r.allow('adaptation.approve', body.studentId)
    const { lessonId, real } = await ensureLesson(r, body)
    const out = await r.student(body.studentId, lensLogApproval, {
      lessonId,
      subject: body.subject,
      items: body.items,
      checks: body.checks,
    })
    const sheets: { goalId: string; checkId: string; sheetCode: string | null }[] = []
    for (const ch of out.checks) {
      const code = real ? (await r.school(sheetCodesIssue, { studentId: body.studentId, lessonId, checkId: ch.id })).sheetCode.code : null
      sheets.push({ goalId: ch.goalId, checkId: ch.id, sheetCode: code })
    }
    return r.json(LensApprovalResponse, { lessonId: out.lensRunId ? lessonId : null, suggestions: out.suggestions, sheets, blocked: out.blocked }, 201)
  })

  app.get('/students/:id/lens-usage', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(LensUsageResponse, await r.student(r.param('id'), lensUsageList))
  })
}
