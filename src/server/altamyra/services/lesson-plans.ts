import { z } from 'zod'
import type { LensAdaptation } from '../contract/ai'
import { DateString, Id, RowVersion } from '../contract/common'
import { AltamyraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can } from '../contract/permissions'
import { LessonPlan, PlanPatchBody, ProposedChange, type LessonPlanView, type PlansTodayResponse } from '../contract/plans'
import { audit, insertEntity, newId, nowIso, updateVersioned, json } from '../repos/base'
import * as repo from '../repos/school'
import { Now, StudentArgs, authorize } from './authz'
import { guardrail } from './student-common'

/** Per-student lesson plans (school room): original, proposed changes, tailored. AI content stays draft until the teacher approves. */

/** The tailored plan text: the original plus the accepted changes. Pure, so the route and the teacher's edits agree. */
export function composeTailored(original: string, proposed: readonly ProposedChange[]): string {
  const accepted = proposed.filter((p) => p.accepted)
  if (accepted.length === 0) return original
  return `${original.trimEnd()}\n\nChanges for this student:\n${accepted.map((p) => `- ${p.text}`).join('\n')}`
}

export function toProposedChanges(adaptations: readonly LensAdaptation[], subject: string, modificationSubjects: readonly string[]): ProposedChange[] {
  return adaptations.flatMap((a) => {
    const { label, blocked } = guardrail(a.changesOutcome, a.modelLabel, subject, modificationSubjects)
    return blocked ? [] : [{ id: newId(), text: `${a.title}: ${a.text}`, label, accepted: true }]
  })
}

export function toView(p: LessonPlan): LessonPlanView {
  return {
    id: p.id,
    studentId: p.studentId,
    date: p.planDate,
    title: p.title,
    originalText: p.originalText,
    proposed: p.proposed,
    tailoredText: p.tailoredText,
    status: p.status,
    approvedBy: p.approvedBy,
    approvedAt: p.approvedAt,
    version: p.version,
  }
}

/** Plan of this student, 404 when the id belongs to another student (no probing across students). */
function planOf(sql: Parameters<typeof repo.lessonPlanById>[0], studentId: string, planId: string): LessonPlan {
  const plan = repo.lessonPlanById(sql, planId)
  if (!plan || plan.studentId !== studentId) throw new AltamyraError('not_found', `lesson plan ${planId} not found`)
  return plan
}

/** Teacher: every class student, drafts included. EA and case manager: approved plans only; a draft shows as no plan. */
export const lessonPlansToday = defineOp({
  name: 'lessonPlans.today',
  room: 'school',
  capability: 'lesson_plan.view',
  args: z.object({ date: DateString }).extend(Now.shape),
  run(sql, args, actor): PlansTodayResponse {
    const ids = Object.keys(actor.studentRoles)
    if (ids.length === 0) throw new AltamyraError('forbidden', 'lesson_plan.view refused: no students in scope')
    const students: PlansTodayResponse['students'] = []
    for (const studentId of ids) {
      const result = can(actor, 'lesson_plan.view', studentId)
      const student = repo.studentById(sql, studentId)
      if (!result.allowed || !student) continue
      const plans = repo.plansForStudentOn(sql, studentId, args.date)
      const visible = result.filter === 'approved_only' ? plans.filter((p) => p.status === 'approved') : plans
      const plan = visible[0]
      students.push({
        studentId,
        label: student.displayToken,
        plan: plan ? { id: plan.id, title: plan.title, status: plan.status } : null,
      })
    }
    students.sort((a, b) => a.label.localeCompare(b.label))
    return { date: args.date, students }
  },
})

export const lessonPlansForStudent = defineOp({
  name: 'lessonPlans.forStudent',
  room: 'school',
  capability: 'lesson_plan.view',
  args: StudentArgs.extend({ date: DateString }).extend(Now.shape),
  run(sql, args, actor): { plans: LessonPlanView[] } {
    const result = authorize(actor, 'lesson_plan.view', args.studentId)
    const plans = repo.plansForStudentOn(sql, args.studentId, args.date)
    const visible = result.filter === 'approved_only' ? plans.filter((p) => p.status === 'approved') : plans
    return { plans: visible.map(toView) }
  },
})

export const lessonPlansCreate = defineOp({
  name: 'lessonPlans.create',
  room: 'school',
  capability: 'lesson_plan.edit',
  args: StudentArgs.extend({
    id: Id.optional(),
    date: DateString,
    title: z.string().min(1).max(200),
    originalText: z.string().min(1),
    proposed: z.array(ProposedChange),
    tailoredText: z.string(),
  }).extend(Now.shape),
  run(sql, args, actor): { plan: LessonPlan } {
    authorize(actor, 'lesson_plan.edit', args.studentId)
    if (!repo.studentById(sql, args.studentId)) throw new AltamyraError('not_found', `student ${args.studentId} not found`)
    if (repo.plansForStudentOn(sql, args.studentId, args.date).length > 0) {
      throw new AltamyraError('version_conflict', 'This student already has a plan for that day. Edit it instead.')
    }
    const at = nowIso(args.now)
    const plan: LessonPlan = {
      id: args.id ?? newId(),
      studentId: args.studentId,
      lessonId: null,
      planDate: args.date,
      title: args.title,
      originalText: args.originalText,
      proposed: args.proposed,
      tailoredText: args.tailoredText,
      status: 'draft',
      createdBy: actor.userId,
      approvedBy: null,
      approvedAt: null,
      createdAt: at,
      version: 1,
    }
    insertEntity(sql, 'lesson_plans', plan)
    audit(sql, actor, 'lesson_plans.create', 'lesson_plans', plan.id, undefined, { studentId: plan.studentId, date: plan.planDate, status: plan.status }, at)
    return { plan }
  },
})

/** Edits keep the plan a draft (an edited, approved plan needs approving again). */
export const lessonPlansUpdate = defineOp({
  name: 'lessonPlans.update',
  room: 'school',
  capability: 'lesson_plan.edit',
  args: PlanPatchBody.extend({ planId: Id, version: RowVersion }).extend(Now.shape),
  run(sql, args, actor): { plan: LessonPlan } {
    authorize(actor, 'lesson_plan.edit', args.studentId)
    const before = planOf(sql, args.studentId, args.planId)

    let proposed = before.proposed
    if (args.proposed) {
      const edits = new Map(args.proposed.map((p) => [p.id, p]))
      for (const id of edits.keys()) if (!proposed.some((p) => p.id === id)) throw new AltamyraError('bad_request', `unknown proposed change ${id}`)
      proposed = proposed.map((p) => {
        const e = edits.get(p.id)
        return e ? { ...p, accepted: e.accepted, text: e.text ?? p.text } : p
      })
    }
    const originalText = args.originalText ?? before.originalText
    // The tailored plan follows the changes unless the teacher wrote it by hand in this request.
    const tailoredText =
      args.tailoredText ?? (args.proposed || args.originalText ? composeTailored(originalText, proposed) : before.tailoredText)
    const at = nowIso(args.now)
    updateVersioned(sql, 'lesson_plans', before.id, args.version, {
      title: args.title ?? before.title,
      original_text: originalText,
      proposed_json: json(proposed),
      tailored_text: tailoredText,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    })
    const plan: LessonPlan = { ...before, title: args.title ?? before.title, originalText, proposed, tailoredText, status: 'draft', approvedBy: null, approvedAt: null, version: before.version + 1 }
    audit(sql, actor, 'lesson_plans.edit', 'lesson_plans', plan.id, { status: before.status, version: before.version }, { status: 'draft', version: plan.version }, at)
    return { plan }
  },
})

/** AI approval rule: the teacher approves the tailored plan before the EA or case manager can see it. */
export const lessonPlansApprove = defineOp({
  name: 'lessonPlans.approve',
  room: 'school',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({ planId: Id, version: RowVersion }).extend(Now.shape),
  run(sql, args, actor): { plan: LessonPlan } {
    authorize(actor, 'adaptation.approve', args.studentId)
    const before = planOf(sql, args.studentId, args.planId)
    const at = nowIso(args.now)
    updateVersioned(sql, 'lesson_plans', before.id, args.version, { status: 'approved', approved_by: actor.userId, approved_at: at })
    const plan: LessonPlan = { ...before, status: 'approved', approvedBy: actor.userId, approvedAt: at, version: before.version + 1 }
    audit(sql, actor, 'lesson_plans.approve', 'lesson_plans', plan.id, { status: before.status }, { status: 'approved', approvedBy: actor.userId }, at)
    return { plan }
  },
})

export const lessonPlanOpList = [
  lessonPlansToday,
  lessonPlansForStudent,
  lessonPlansCreate,
  lessonPlansUpdate,
  lessonPlansApprove,
]
