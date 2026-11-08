import { z } from 'zod'
import type { BulkApproveResponse, LensStudentResult, StudentProfileResponse, SuggestionResponse } from '../contract/api'
import { LensAdaptation, LensCheck, LensGap, type DeidentifiedProfile } from '../contract/ai'
import { ExpectedVersion, Id, RowVersion } from '../contract/common'
import { Label } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor } from '../contract/permissions'
import type { AdaptationSuggestion, Check, LensRun, Suggestion, UsageEvent } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { STUDENT_FIXTURES, seedStudent } from '../fixtures'
import { assertVersion, audit, insertEntity, newId, nowIso, updateVersioned } from '../repos/base'
import { confirmedObjectiveForGoal, currentGoals, currentIep, objectiveById } from '../repos/iep'
import * as lens from '../repos/lens'
import { Now, StudentArgs, authorize } from './authz'
import { guardrail, requireCurrentIep, whatWorksFor } from './student-common'

/** Student-room ops for feature 1A (lesson augmentation) and the student profile. */

/** AI adaptation with the code-decided label already attached by the caller. */
const LabelledAdaptation = LensAdaptation.extend({ label: Label })
type LabelledAdaptation = z.infer<typeof LabelledAdaptation>

const stripKeys = (c: Check): Check => ({ ...c, answerKey: null, rubric: null })

function requireSuggestion(sql: SqlExecutor, id: string): Suggestion {
  const s = lens.suggestionById(sql, id)
  if (!s) throw new AltamiraError('not_found', `suggestion ${id} not found`)
  return s
}

function requireAdaptation(sql: SqlExecutor, id: string): AdaptationSuggestion {
  const s = requireSuggestion(sql, id)
  if (s.kind !== 'adaptation') throw new AltamiraError('bad_request', 'only adaptations can be approved, edited or regenerated')
  return s
}

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
    const allowed = authorize(actor, 'iep.view', args.studentId)
    const iep = currentIep(sql)
    if (allowed.filter === 'all') {
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
    }
    if (allowed.filter === 'supports_only' || allowed.filter === 'supports_applied') {
      // EA and student mode: supports only, never IEP text (PRD "Student mode never shows IEP text").
      return {
        view: 'supports',
        id: args.studentId,
        firstName: iep ? (iep.sections.student.preferredName ?? iep.sections.student.firstName) : null,
        supports: iep?.sections.supports ?? [],
      }
    }
    throw new AltamiraError('forbidden', 'use the Today View for this link')
  },
})

/** What the route needs to build LensForStudentInput. The AI module de-identifies it before any call. */
export const lensContext = defineOp({
  name: 'lens.context',
  room: 'student',
  capability: 'lesson.augment',
  args: StudentArgs.extend({ studentToken: z.string().min(1), grade: z.string().min(1) }),
  run(sql, args, actor) {
    authorize(actor, 'lesson.augment', args.studentId)
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
  capability: 'lesson.augment',
  args: StudentArgs.extend({
    lessonId: Id,
    analysisId: Id,
    subject: z.string().min(1),
    gaps: z.array(LensGap),
    adaptations: z.array(LabelledAdaptation),
    checks: z.array(LensCheck).max(3),
  }).extend(Now.shape),
  run(sql, args, actor): LensStudentResult {
    authorize(actor, 'lesson.augment', args.studentId)
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
      if (!objectiveById(sql, c.objectiveId)) throw new AltamiraError('bad_request', `check names unknown objective ${c.objectiveId}`)
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

/** GET /lessons/:lid/lens/:sid. EAs and parents see approved adaptations only (PRD matrix "View"). */
export const lensGet = defineOp({
  name: 'lens.get',
  room: 'student',
  capability: 'lesson.augment',
  args: StudentArgs.extend({ lessonId: Id }),
  run(sql, args, actor): LensStudentResult | null {
    const allowed = authorize(actor, 'lesson.augment', args.studentId, { access: 'read' })
    if (allowed.filter === 'supports_applied') throw new AltamiraError('forbidden', 'student mode receives items through sessions')
    const run = lens.latestLensRun(sql, args.lessonId)
    if (!run) return null
    const all = lens.suggestionsForRun(sql, run.id)
    if (allowed.filter === 'all') {
      return { studentId: args.studentId, lensRun: run, suggestions: all, checks: lens.checksForSuggestions(sql, all.map((s) => s.id)) }
    }
    const approved = all.filter((s) => s.kind === 'adaptation' && s.status === 'approved')
    const checks = lens.checksForSuggestions(sql, approved.map((s) => s.id)).map(stripKeys)
    return { studentId: args.studentId, lensRun: run, suggestions: approved, checks }
  },
})

// ---------- approve, edit, regenerate, reject (PRD 1A-7) ----------

type ApprovalCheck = 'ok' | 'blocked' | 'conflict' | 'not_approvable'

function checkApproval(sql: SqlExecutor, actor: Actor, studentId: string, s: AdaptationSuggestion, expectedVersion: number): ApprovalCheck {
  if (s.version !== expectedVersion) return 'conflict'
  if (s.status === 'rejected' || s.status === 'approved') return 'not_approvable'
  if (s.label === 'modification') {
    // PRD 1A-5: a modification is applied only where the IEP authorizes it for that subject.
    const iep = currentIep(sql)
    const result = can(actor, 'modification.apply', studentId, {
      subject: s.content.subject,
      modificationSubjects: iep?.modificationSubjects ?? [],
    })
    if (!result.allowed) return 'blocked'
  }
  return 'ok'
}

/** Writes the approval and its usage event in the caller's transaction (PRD 1A-7). */
function writeApproval(sql: SqlExecutor, actor: Actor, s: AdaptationSuggestion, at: string): { suggestion: Suggestion; usageEventId: string } {
  updateVersioned(sql, 'suggestions', s.id, s.version, { status: 'approved' })
  const approved: Suggestion = { ...s, status: 'approved', version: s.version + 1 }
  audit(sql, actor, 'suggestions.approve', 'suggestions', s.id, { status: s.status }, { status: 'approved' }, at)
  const usage: UsageEvent = { id: newId(), suggestionId: s.id, approvedBy: actor.userId, at }
  insertEntity(sql, 'usage_events', usage)
  audit(sql, actor, 'usage_events.create', 'usage_events', usage.id, undefined, usage, at)
  return { suggestion: approved, usageEventId: usage.id }
}

export const suggestionsApprove = defineOp({
  name: 'suggestions.approve',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({ suggestionId: Id }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): SuggestionResponse {
    authorize(actor, 'adaptation.approve', args.studentId)
    const s = requireAdaptation(sql, args.suggestionId)
    const state = checkApproval(sql, actor, args.studentId, s, args.expectedVersion)
    if (state === 'conflict') assertVersion(s.version, args.expectedVersion, `suggestion ${s.id}`)
    if (state === 'not_approvable') throw new AltamiraError('bad_request', `a ${s.status} suggestion cannot be approved`)
    if (state === 'blocked') throw new AltamiraError('forbidden', 'modification.apply refused: not_iep_authorized')
    return writeApproval(sql, actor, s, nowIso(args.now))
  },
})

export const suggestionsBulkApprove = defineOp({
  name: 'suggestions.bulkApprove',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({
    items: z.array(z.object({ suggestionId: Id, expectedVersion: RowVersion })).min(1),
  }).extend(Now.shape),
  run(sql, args, actor): z.infer<typeof BulkApproveResponse> {
    authorize(actor, 'adaptation.approve', args.studentId)
    const at = nowIso(args.now)
    const result = { approved: [] as string[], blocked: [] as string[], conflicts: [] as string[] }
    for (const item of args.items) {
      const s = requireAdaptation(sql, item.suggestionId)
      const state = checkApproval(sql, actor, args.studentId, s, item.expectedVersion)
      if (state === 'ok') {
        writeApproval(sql, actor, s, at)
        result.approved.push(s.id)
      } else if (state === 'blocked') result.blocked.push(s.id)
      else result.conflicts.push(s.id)
    }
    return result
  },
})

export const suggestionsEdit = defineOp({
  name: 'suggestions.edit',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({
    suggestionId: Id,
    content: z.object({ title: z.string().min(1), text: z.string().min(1), why: z.string() }).partial(),
    goalIds: z.array(Id).min(1).optional(),
    /** The route's classifyAdaptation() label for the edited text (PRD 1A-5). */
    label: Label,
  })
    .extend(ExpectedVersion.shape)
    .extend(Now.shape),
  run(sql, args, actor): SuggestionResponse {
    authorize(actor, 'adaptation.approve', args.studentId)
    const s = requireAdaptation(sql, args.suggestionId)
    assertVersion(s.version, args.expectedVersion, `suggestion ${s.id}`)
    if (s.status === 'rejected') throw new AltamiraError('bad_request', 'a rejected suggestion cannot be edited')
    const iep = requireCurrentIep(sql)
    const at = nowIso(args.now)
    const content = { ...s.content, ...args.content }
    const goalIds = args.goalIds ?? s.goalIds
    // PRD 1A-5: the edited text is labelled again; an unauthorized modification is blocked. Any edit needs a fresh approval.
    const { label, blocked } = guardrail(content.changesOutcome, args.label, content.subject, iep.modificationSubjects)
    const status = blocked ? 'blocked' : 'edited'
    updateVersioned(sql, 'suggestions', s.id, s.version, {
      content_json: JSON.stringify(content),
      goal_ids_json: JSON.stringify(goalIds),
      label,
      status,
    })
    const edited: Suggestion = { ...s, content, goalIds, label, status, version: s.version + 1 }
    audit(sql, actor, 'suggestions.edit', 'suggestions', s.id, s, edited, at)
    return { suggestion: edited, usageEventId: null }
  },
})

/** Regenerate: the caller passes the new AI adaptation; the old row is closed and a new row is created. */
export const suggestionsRegenerate = defineOp({
  name: 'suggestions.regenerate',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({ suggestionId: Id, adaptation: LabelledAdaptation }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): SuggestionResponse {
    authorize(actor, 'adaptation.approve', args.studentId)
    const old = requireAdaptation(sql, args.suggestionId)
    assertVersion(old.version, args.expectedVersion, `suggestion ${old.id}`)
    if (old.status === 'rejected') throw new AltamiraError('bad_request', 'a rejected suggestion cannot be regenerated')
    const at = nowIso(args.now)
    const iep = requireCurrentIep(sql)
    const fresh = newAdaptation(old.lensRunId, args.adaptation, old.content.subject, iep.modificationSubjects, at)
    updateVersioned(sql, 'suggestions', old.id, old.version, { status: 'rejected' })
    audit(sql, actor, 'suggestions.regenerate', 'suggestions', old.id, { status: old.status }, { status: 'rejected', replacedBy: fresh.id }, at)
    lens.insertSuggestion(sql, fresh)
    audit(sql, actor, 'suggestions.create', 'suggestions', fresh.id, undefined, { ...fresh, regeneratedFrom: old.id }, at)
    // Checks stay with the lesson: move active checks from the old row to its replacement.
    for (const c of lens.checksForSuggestions(sql, [old.id])) {
      updateVersioned(sql, 'checks', c.id, c.version, { suggestion_id: fresh.id })
      audit(sql, actor, 'checks.move', 'checks', c.id, { suggestionId: old.id }, { suggestionId: fresh.id }, at)
    }
    return { suggestion: fresh, usageEventId: null }
  },
})

export const suggestionsReject = defineOp({
  name: 'suggestions.reject',
  room: 'student',
  capability: 'adaptation.approve',
  args: StudentArgs.extend({ suggestionId: Id, reason: z.string().nullable().default(null) })
    .extend(ExpectedVersion.shape)
    .extend(Now.shape),
  run(sql, args, actor): SuggestionResponse {
    authorize(actor, 'adaptation.approve', args.studentId)
    const s = requireSuggestion(sql, args.suggestionId)
    assertVersion(s.version, args.expectedVersion, `suggestion ${s.id}`)
    const at = nowIso(args.now)
    updateVersioned(sql, 'suggestions', s.id, s.version, { status: 'rejected' })
    audit(sql, actor, 'suggestions.reject', 'suggestions', s.id, { status: s.status }, { status: 'rejected', reason: args.reason }, at)
    return { suggestion: { ...s, status: 'rejected', version: s.version + 1 } as Suggestion, usageEventId: null }
  },
})

// ---------- checks (PRD 1A-6) ----------

export const checksList = defineOp({
  name: 'checks.list',
  room: 'student',
  capability: 'lesson.augment',
  args: StudentArgs.extend({ lessonId: Id.optional() }),
  run(sql, args, actor): { checks: Check[] } {
    const allowed = authorize(actor, 'lesson.augment', args.studentId, { access: 'read' })
    if (allowed.filter === 'supports_applied') throw new AltamiraError('forbidden', 'student mode receives items through sessions')
    let checks: Check[]
    if (args.lessonId) {
      const run = lens.latestLensRun(sql, args.lessonId)
      const ids = run ? lens.suggestionsForRun(sql, run.id).map((s) => s.id) : []
      checks = lens.checksForSuggestions(sql, ids)
    } else {
      checks = allowed.filter === 'all' ? lens.checksForSuggestions(sql, allSuggestionIds(sql)) : lens.approvedChecks(sql)
    }
    if (allowed.filter !== 'all') {
      const approved = new Set(lens.approvedAdaptations(sql).map((a) => a.id))
      checks = checks.filter((c) => approved.has(c.suggestionId)).map(stripKeys)
    }
    return { checks }
  },
})

const allSuggestionIds = (sql: SqlExecutor) => sql.all<{ id: string }>('SELECT id FROM suggestions').map((r) => r.id)

/** PRD 1A-6: checks are generated by default; the teacher can remove them. */
export const checksRemove = defineOp({
  name: 'checks.remove',
  room: 'student',
  capability: 'lesson.augment',
  args: StudentArgs.extend({ checkId: Id }).extend(ExpectedVersion.shape).extend(Now.shape),
  run(sql, args, actor): { check: Check } {
    authorize(actor, 'lesson.augment', args.studentId)
    const c = lens.checkById(sql, args.checkId)
    if (!c) throw new AltamiraError('not_found', `check ${args.checkId} not found`)
    updateVersioned(sql, 'checks', c.id, args.expectedVersion, { status: 'removed' })
    audit(sql, actor, 'checks.remove', 'checks', c.id, { status: c.status }, { status: 'removed' }, nowIso(args.now))
    return { check: { ...c, status: 'removed', version: c.version + 1 } }
  },
})

// ---------- dev seed (POST /dev/seed, dev only) ----------

export const studentDevSeed = defineOp({
  name: 'dev.seed',
  room: 'student',
  args: StudentArgs,
  run(sql, args) {
    const fixture = STUDENT_FIXTURES.find((f) => f.studentId === args.studentId)
    if (!fixture) throw new AltamiraError('not_found', `no fixture for student ${args.studentId}`)
    if (sql.get('SELECT 1 AS x FROM iep_versions LIMIT 1')) throw new AltamiraError('bad_request', 'student room is already seeded')
    seedStudent(sql, fixture)
    return { studentId: fixture.studentId, key: fixture.key }
  },
})

export const lensOpList = [
  profileGet,
  lensContext,
  lensSaveRun,
  lensGet,
  suggestionsApprove,
  suggestionsBulkApprove,
  suggestionsEdit,
  suggestionsRegenerate,
  suggestionsReject,
  checksList,
  checksRemove,
  studentDevSeed,
]
