import { z } from 'zod'
import type { LensStudentResult, StudentProfileResponse } from '../contract/api'
import { LensAdaptation, LensCheck, LensGap, type DeidentifiedProfile } from '../contract/ai'
import { Id } from '../contract/common'
import { AdaptationType, Label } from '../contract/enums'
import { AltamyraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can } from '../contract/permissions'
import { CheckItem, type AdaptationSuggestion, type Check, type LensRun, type Suggestion, type UsageEvent } from '../contract/student'
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
  capability: 'iep.view',
  args: StudentArgs.extend({ displayToken: z.string(), grade: z.string() }),
  run(sql, args, actor): StudentProfileResponse {
    authorize(actor, 'iep.view', args.studentId)
    const iep = currentIep(sql)
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
  capability: 'lesson_plan.edit',
  args: StudentArgs.extend({ studentToken: z.string().min(1), grade: z.string().min(1) }),
  run(sql, args, actor) {
    authorize(actor, 'lesson_plan.edit', args.studentId)
    const iep = requireCurrentIep(sql)
    const profile: DeidentifiedProfile = {
      studentToken: args.studentToken,
      grade: args.grade,
      strengths: iep.sections.profile.strengths,
      interests: iep.sections.profile.interests,
      goals: currentGoals(sql).map((g) => {
        const o = confirmedObjectiveForGoal(sql, g.id)
        return {
          goalId: g.id,
          area: g.area,
          text: g.text,
          objective: o ? { objectiveId: o.id, metricType: o.metricType, unit: o.unit, target: o.target } : null,
        }
      }),
      accommodations: iep.sections.accommodations,
      supports: iep.sections.supports,
      modificationSubjects: iep.modificationSubjects,
    }
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
  capability: 'lesson_plan.edit',
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

// ---------- Lesson Lens (dashboard flow): approval logs usage into 1B ----------

/**
 * The teacher approved adaptations in the Lens page. Each is stored as an approved adaptation with its
 * usage event, so it shows on the student's record and counts in What works once evidence is captured in
 * that lesson. A modification the IEP does not authorize is refused (PRD 1A-5), whatever the page sent.
 * One check per goal is stored so a coded sheet can be issued for it (PRD 1A-6, 1A-7).
 */
export const lensLogApproval = defineOp({
  name: 'lens.logApproval',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({
    lessonId: Id,
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
    checks: z.array(z.object({ goalId: Id, items: z.array(CheckItem).min(1).max(3) })).max(10).default([]),
  }).extend(Now.shape),
  run(sql, args, actor) {
    authorize(actor, 'adaptation.approve', args.studentId)
    const iep = requireCurrentIep(sql)
    const at = nowIso(args.now)
    const current = new Set(currentGoals(sql).map((g) => g.id))
    const run: LensRun = { id: newId(), lessonId: args.lessonId, analysisId: newId(), createdBy: actor.userId, createdAt: at }
    const blocked: string[] = []
    const saved: AdaptationSuggestion[] = []
    for (const it of args.items) {
      if (!current.has(it.goalId)) continue
      const changesOutcome = it.label === 'modify'
      const { label, blocked: stop } = guardrail(changesOutcome, 'adaptation', args.subject, iep.modificationSubjects)
      if (stop || (label === 'modification' && !can(actor, 'modification.apply', args.studentId, { subject: args.subject, modificationSubjects: iep.modificationSubjects }).allowed)) {
        blocked.push(it.goalId)
        continue
      }
      saved.push({
        id: newId(),
        lensRunId: run.id,
        kind: 'adaptation',
        gapType: null,
        adaptationType: it.adaptationType,
        label,
        goalIds: [it.goalId],
        content: { title: it.title, text: it.text, why: it.why, subject: args.subject, changesOutcome },
        status: 'approved',
        createdAt: at,
        version: 1,
      })
    }
    if (!saved.length) return { lensRunId: null, suggestions: [], checks: [], blocked }
    insertEntity(sql, 'lens_runs', run)
    audit(sql, actor, 'lens_runs.create', 'lens_runs', run.id, undefined, run, at)
    for (const s of saved) {
      lens.insertSuggestion(sql, s)
      audit(sql, actor, 'suggestions.create', 'suggestions', s.id, undefined, s, at)
      const usage: UsageEvent = { id: newId(), suggestionId: s.id, approvedBy: actor.userId, at }
      insertEntity(sql, 'usage_events', usage)
      audit(sql, actor, 'usage_events.create', 'usage_events', usage.id, undefined, usage, at)
    }
    const checks: { id: string; goalId: string }[] = []
    for (const c of args.checks) {
      const host = saved.find((s) => s.goalIds.includes(c.goalId))
      const objective = host ? confirmedObjectiveForGoal(sql, c.goalId) : undefined
      if (!host || !objective) continue
      const check: Check = {
        id: newId(),
        suggestionId: host.id,
        objectiveId: objective.id,
        items: c.items,
        answerKey: null,
        rubric: {
          criteria: [{ id: 'shown', description: 'The student shows the skill in the goal.' }],
          levels: [{ score: 0, description: 'Not yet shown' }, { score: 1, description: 'Shown' }],
        },
        status: 'active',
        version: 1,
      }
      lens.insertCheck(sql, check)
      audit(sql, actor, 'checks.create', 'checks', check.id, undefined, check, at)
      checks.push({ id: check.id, goalId: c.goalId })
    }
    return { lensRunId: run.id, suggestions: saved.map((s) => ({ id: s.id, goalId: s.goalIds[0]! })), checks, blocked }
  },
})

/** Approved adaptations of this student with their usage events, newest first (the timeline and What works "used" view). */
export const lensUsageList = defineOp({
  name: 'lens.usageList',
  room: 'student',
  capability: 'progress.view',
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
  lensLogApproval,
  lensUsageList,
]
