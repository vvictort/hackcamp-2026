import { z } from 'zod'
import type { LensStudentResult, StudentProfileResponse } from '../contract/api'
import { toAiProfile } from '../ai/profile'
import { LensAdaptation, LensCheck, LensGap } from '../contract/ai'
import { Id } from '../contract/common'
import { AdaptationType, Label } from '../contract/enums'
import { AltamyraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { rolesFor } from '../contract/permissions'
import type { AdaptationSuggestion, Check, LensRun, Suggestion } from '../contract/student'
import { audit, insertEntity, newId, nowIso } from '../repos/base'
import { confirmedObjectiveForGoal, currentGoals, currentIep, objectiveById } from '../repos/iep'
import * as lens from '../repos/lens'
import { Now, StudentArgs, authorize } from './authz'
import { guardrail, requireCurrentIep, whatWorksFor } from './student-common'

/** Student-room ops for feature 1A (lesson augmentation) and the student profile. */

/** AI adaptation with the code-decided label already attached by the caller. */
const LabelledAdaptation = LensAdaptation.extend({ label: Label })
type LabelledAdaptation = z.infer<typeof LabelledAdaptation>

function newAdaptation(
  lensRunId: string,
  a: LabelledAdaptation,
  subject: string,
  modificationSubjects: readonly string[],
  at: string,
): AdaptationSuggestion {
  const { label, blocked } = guardrail(a.changesOutcome, a.label, subject, modificationSubjects)
  return {
    id: newId(),
    lensRunId,
    kind: 'adaptation',
    gapType: null,
    adaptationType: a.adaptationType,
    label,
    goalIds: a.goalIds,
    content: { title: a.title, text: a.text, why: a.why, subject, changesOutcome: a.changesOutcome },
    // PRD 1A-5: a modification the IEP does not authorize is stored as blocked.
    status: blocked ? 'blocked' : 'draft',
    createdAt: at,
    version: 1,
  }
}

// ---------- profile (GET /students/:id) and lens input ----------

export const profileGet = defineOp({
  name: 'profile.get',
  room: 'student',
  args: StudentArgs.extend({ displayToken: z.string(), grade: z.string() }),
  run(sql, args, actor): StudentProfileResponse {
    authorize(actor, 'iep.view', args.studentId)
    const iep = currentIep(sql)
    // PRD "Roles and modes": an EA sees supports and what works, not the IEP text.
    // The case manager and the teacher keep the full view (an actor who is both
    // a teacher and an EA keeps the wider one).
    const staffRead = rolesFor(actor, args.studentId).some((r) => r === 'case_manager' || r === 'teacher')
    if (!staffRead) {
      const sections = iep?.sections
      return {
        view: 'supports',
        id: args.studentId,
        firstName: sections ? (sections.student.preferredName ?? sections.student.firstName) : null,
        supports: sections ? [...new Set([...sections.supports, ...sections.accommodations])] : [],
      }
    }
    return {
      view: 'full',
      id: args.studentId,
      displayToken: args.displayToken,
      grade: args.grade,
      iepVersion: iep?.version ?? null,
      sections: iep?.sections ?? null,
      modificationSubjects: iep?.modificationSubjects ?? [],
      goals: currentGoals(sql),
    }
  },
})

/** What the route needs to build LensForStudentInput. The AI module de-identifies it before any call. */
export const lensContext = defineOp({
  name: 'lens.context',
  room: 'student',
  args: StudentArgs.extend({ studentToken: z.string().min(1), grade: z.string().min(1) }),
  run(sql, args, actor) {
    authorize(actor, 'lesson_plan.edit', args.studentId)
    const iep = requireCurrentIep(sql)
    const profile = toAiProfile({
      token: args.studentToken,
      grade: args.grade,
      iep,
      goals: currentGoals(sql),
      objectiveFor: (goalId) => confirmedObjectiveForGoal(sql, goalId),
    })
    // PRD 1A-9: only rows meeting the minimum sample rule may steer suggestions.
    const whatWorks = whatWorksFor(sql)
      .filter((r) => !r.hidden)
      .map(({ adaptationType, n, meanOutcome }) => ({ adaptationType, n, meanOutcome }))
    return { profile, whatWorks }
  },
})

// ---------- lens runs (PRD 1A-3, 1A-4, 1A-5, 1A-6) ----------

export const lensSaveRun = defineOp({
  name: 'lens.saveRun',
  room: 'student',
  args: StudentArgs.extend({
    lessonId: Id,
    analysisId: Id,
    subject: z.string().min(1),
    gaps: z.array(LensGap),
    adaptations: z.array(LabelledAdaptation),
    checks: z.array(LensCheck).max(3),
  }).extend(Now.shape),
  run(sql, args, actor): LensStudentResult {
    authorize(actor, 'lesson_plan.edit', args.studentId)
    const iep = requireCurrentIep(sql)
    const at = nowIso(args.now)
    const run: LensRun = { id: newId(), lessonId: args.lessonId, analysisId: args.analysisId, createdBy: actor.userId, createdAt: at }
    insertEntity(sql, 'lens_runs', run)
    audit(sql, actor, 'lens_runs.create', 'lens_runs', run.id, undefined, run, at)

    // PRD 1A-3 / 1A-4: goal tags must be this student's current goals. Unknown ids are dropped; an
    // adaptation left with no goal, or a gap with neither goal nor accommodation, is not stored.
    const current = new Set(currentGoals(sql).map((g) => g.id))
    const known = (ids: readonly string[]) => ids.filter((id) => current.has(id))
    const gaps = args.gaps.map((g) => ({ ...g, goalIds: known(g.goalIds) })).filter((g) => g.goalIds.length > 0 || g.accommodation)
    const tagged = args.adaptations.map((a) => ({ ...a, goalIds: known(a.goalIds) })).filter((a) => a.goalIds.length > 0)

    const suggestions: Suggestion[] = []
    for (const g of gaps) {
      suggestions.push({
        id: newId(),
        lensRunId: run.id,
        kind: 'gap',
        gapType: g.gapType,
        adaptationType: null,
        label: null,
        goalIds: g.goalIds,
        content: { title: g.title, why: g.why, accommodation: g.accommodation },
        status: 'draft',
        createdAt: at,
        version: 1,
      })
    }
    for (const a of tagged) suggestions.push(newAdaptation(run.id, a, args.subject, iep.modificationSubjects, at))
    for (const s of suggestions) {
      lens.insertSuggestion(sql, s)
      audit(sql, actor, 'suggestions.create', 'suggestions', s.id, undefined, s, at)
    }

    // PRD 1A-6: checks are embedded in the adapted lesson; each is attached to the adaptation for its goal.
    const adaptations = suggestions.filter((s): s is AdaptationSuggestion => s.kind === 'adaptation')
    const checks: Check[] = []
    for (const c of args.checks) {
      if (!objectiveById(sql, c.objectiveId)) throw new AltamyraError('bad_request', `check names unknown objective ${c.objectiveId}`)
      const host = adaptations.find((s) => s.goalIds.includes(c.goalId)) ?? adaptations[0] ?? suggestions[0]
      if (!host) break
      const check: Check = {
        id: newId(),
        suggestionId: host.id,
        objectiveId: c.objectiveId,
        items: c.items,
        answerKey: c.answerKey,
        rubric: c.rubric,
        status: 'active',
        version: 1,
      }
      lens.insertCheck(sql, check)
      audit(sql, actor, 'checks.create', 'checks', check.id, undefined, check, at)
      checks.push(check)
    }
    return { studentId: args.studentId, lensRun: run, suggestions, checks }
  },
})

/** Approved adaptations of this student with their usage events, newest first (the timeline and What works "used" view). */
export const lensUsageList = defineOp({
  name: 'lens.usageList',
  room: 'student',
  args: StudentArgs,
  run(sql, args, actor) {
    authorize(actor, 'progress.view', args.studentId)
    const rows = sql.all<{ id: string; at: string }>(
      `SELECT s.id AS id, u.at AS at FROM usage_events u JOIN suggestions s ON s.id = u.suggestion_id
       WHERE s.kind = 'adaptation' ORDER BY u.at DESC, u.rowid DESC LIMIT 100`,
    )
    const events = rows.flatMap((r) => {
      const s = lens.suggestionById(sql, r.id)
      if (!s || s.kind !== 'adaptation') return []
      return [{ suggestionId: s.id, at: r.at, label: s.label, adaptationType: s.adaptationType, title: s.content.title, text: s.content.text, goalIds: s.goalIds }]
    })
    const byType = new Map<AdaptationType, number>()
    for (const e of events) byType.set(e.adaptationType, (byType.get(e.adaptationType) ?? 0) + 1)
    return { events, used: [...byType].map(([adaptationType, n]) => ({ adaptationType, n })) }
  },
})

export const lensOpList = [
  profileGet,
  lensContext,
  lensSaveRun,
  lensUsageList,
]
