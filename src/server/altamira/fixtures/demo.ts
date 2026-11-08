import { z } from 'zod'
import { Id } from '../contract/common'
import { defineOp } from '../contract/ops'
import type { AdaptationType } from '../contract/enums'
import { AltamiraError } from '../contract/errors'
import type { Lesson } from '../contract/school'
import type { DataPoint, Decision, Objective, Probe, Suggestion, UsageEvent } from '../contract/student'
import { appendAudit } from '../db/audit'
import { insertRow, toRow } from '../db/mapping'
import type { SqlExecutor } from '../db/sql'
import { CLASS_IDS, STUDENT_IDS, USER_IDS } from './school'
import { seedSchool } from './seed'
import { STUDENT_FIXTURES, type StudentFixture } from './students'

/**
 * Dev-only demo layer. The static fixtures keep fixed dates for the test
 * suite; the demo layer re-dates every record relative to the seed time (now
 * minus N days) so Pulse, Coming up and the digest look alive on any day.
 * Reached only through POST /dev/seed, which 404s unless ALTAMIRA_DEV_SEED is "true".
 */

const DAY_MS = 86_400_000
const SEED_ACTOR = 'system:fixtures'

export const daysAgo = (now: string, days: number): string => new Date(Date.parse(now) - days * DAY_MS).toISOString()
export const daysAhead = (now: string, days: number): string => daysAgo(now, -days)
const dateOnly = (iso: string): string => iso.slice(0, 10)
const SCHOOL_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Hex-only ids so they pass any uuid-shaped check. */
const hexId = (prefix: string, a: string, n: number): string => `${prefix}-0000-4000-8000-${a}${String(n).padStart(11, '0')}`

type Series = {
  objectiveIndex: number
  source: DataPoint['source']
  recorder: string
  classId: string | null
  /** [days ago, value] */
  points: [number, number][]
  /** Adaptation type active on points at least this many days old (null = none). */
  adaptation: AdaptationType | null
  /** Only points with days >= this carry the adaptation. */
  adaptationMinDays: number
}

type Plan = {
  series: Series[]
  /** Extra low-confidence photo point awaiting review (objective index), days ago. */
  pending?: { objectiveIndex: number; days: number; value: number }
  decisions: { objectiveIndex: number; rule: Decision['rule']; daysAgo: number }[]
  /** Days ahead of the seed for the IEP review meeting. */
  iepMeetingInDays: number
  extraConsent?: 'audio'
}

const PLANS: Record<string, Plan> = {
  kai: {
    series: [
      {
        objectiveIndex: 0,
        source: 'photo',
        recorder: USER_IDS.teacher,
        classId: CLASS_IDS.literacy,
        points: [[41, 42], [37, 45], [34, 50], [30, 53], [26, 58], [22, 60], [18, 66], [14, 68], [10, 72], [6, 75], [3, 78]],
        adaptation: 'chunked_steps',
        adaptationMinDays: 3,
      },
      {
        objectiveIndex: 1,
        source: 'ea',
        recorder: USER_IDS.ea,
        classId: null,
        points: [[40, 1], [36, 1], [33, 2], [29, 1], [25, 1], [21, 2], [17, 1], [13, 1], [9, 2], [5, 1], [2, 1]],
        adaptation: 'visual_supports',
        adaptationMinDays: 2,
      },
    ],
    pending: { objectiveIndex: 0, days: 1, value: 40 },
    decisions: [{ objectiveIndex: 1, rule: 'below_aimline', daysAgo: 1 }],
    iepMeetingInDays: 6,
    extraConsent: 'audio',
  },
  amara: {
    series: [
      {
        objectiveIndex: 0,
        source: 'ea',
        recorder: USER_IDS.teacher,
        classId: CLASS_IDS.literacy,
        // Only one point in the last 14 days: Pulse shows this goal as Stale.
        points: [[40, 3], [35, 3], [31, 4], [27, 4], [23, 4], [19, 5], [15, 4], [4, 5]],
        adaptation: 'sentence_frames',
        adaptationMinDays: 19,
      },
    ],
    decisions: [],
    iepMeetingInDays: 4,
  },
  sofia: {
    series: [
      {
        objectiveIndex: 0,
        source: 'photo',
        recorder: USER_IDS.ea,
        classId: CLASS_IDS.numeracy,
        points: [[41, 50], [38, 54], [34, 58], [30, 62], [27, 65], [23, 68], [19, 71], [15, 73], [11, 75], [7, 77], [3, 78]],
        adaptation: 'visual_supports',
        adaptationMinDays: 3,
      },
      {
        objectiveIndex: 1,
        source: 'ea',
        recorder: USER_IDS.ea,
        classId: null,
        // Nothing in the last 14 days: Pulse shows this goal as Data needed.
        points: [[42, 0], [39, 0], [36, 1], [33, 0], [30, 1], [27, 0], [24, 1], [20, 1], [17, 0], [16, 1]],
        adaptation: 'sentence_frames',
        adaptationMinDays: 16,
      },
    ],
    decisions: [{ objectiveIndex: 1, rule: 'data_needed', daysAgo: 2 }],
    iepMeetingInDays: 11,
  },
}

const ADAPTATION_TEXT: Record<string, { title: string; text: string; why: string; subject: string }> = {
  chunked_steps: { title: 'Chunk the retell into steps', text: 'Break the text into three short parts and retell each part before moving on.', why: 'Supports the reading retell goal.', subject: 'literacy' },
  visual_supports: { title: 'Use the visual schedule and break card', text: 'Point to the visual schedule before transitions and keep the break card on the desk.', why: 'Supports independent requests for a break.', subject: 'literacy' },
  sentence_frames: { title: 'Sentence frames for the planner', text: 'Offer "First..., then..., because..." frames next to the planner.', why: 'Supports writing connected sentences.', subject: 'literacy' },
}

export const DEMO_LESSON_IDS = {
  salmon: 'e5500000-0000-4000-8000-000000000001',
  counting: 'e5500000-0000-4000-8000-000000000002',
}

/** A short retell probe with an answer key for Kai's confirmed reading goal, so student mode has an item (fictional content). */
function kaiProbe(objectiveId: string, letter: string): Probe {
  return {
    id: hexId('b0000000', letter, 1),
    objectiveId,
    skill: 'retell',
    level: 'grade 2',
    form: {
      items: [
        { id: 'p1', prompt: 'Salmon hatch from eggs in a stream. Where do salmon hatch?', format: 'multiple_choice', options: ['In a stream', 'On a mountain', 'In a tree'] },
        { id: 'p2', prompt: 'Salmon swim to the ocean. What do they do there?', format: 'multiple_choice', options: ['They grow bigger', 'They sleep all year', 'They climb trees'] },
        { id: 'p3', prompt: 'How many parts does the salmon story have: hatch, grow, return? Type the number.', format: 'numeric', options: null },
      ],
      answerKey: [
        { itemId: 'p1', accepted: ['In a stream'] },
        { itemId: 'p2', accepted: ['They grow bigger'] },
        { itemId: 'p3', accepted: ['3', 'three'] },
      ],
      timeLimitSeconds: null,
    },
  }
}

/** Pure: the re-dated fixture plus the extra demo rows for one student. */
export function buildDemoStudent(fixture: StudentFixture, now: string) {
  const plan = PLANS[fixture.key]
  const key = fixture.key
  const letter = { kai: 'a', amara: 'b', sofia: 'c' }[key]
  const objectives: Objective[] = fixture.objectives.map((o) => ({
    ...o,
    status: 'confirmed',
    reviewDate: dateOnly(daysAhead(now, 120)),
    confirmedBy: USER_IDS.caseManager,
    confirmedAt: daysAgo(now, 45),
  }))
  const iep = {
    ...fixture.iep,
    sections: { ...fixture.iep.sections, reviewDate: dateOnly(daysAhead(now, plan.iepMeetingInDays)) },
    importedAt: daysAgo(now, 50),
    confirmedAt: daysAgo(now, 45),
  }

  const runId = hexId('4e000000', letter, 1)
  const lessonId = key === 'sofia' ? DEMO_LESSON_IDS.counting : DEMO_LESSON_IDS.salmon
  const suggestions: Suggestion[] = []
  const suggestionOf = new Map<string, string>()
  for (const s of plan.series) {
    if (!s.adaptation || suggestionOf.has(s.adaptation)) continue
    const text = ADAPTATION_TEXT[s.adaptation] ?? ADAPTATION_TEXT.visual_supports
    const id = hexId('5a000000', letter, suggestions.length + 1)
    suggestionOf.set(s.adaptation, id)
    suggestions.push({
      id,
      lensRunId: runId,
      kind: 'adaptation',
      gapType: null,
      adaptationType: s.adaptation,
      label: 'adaptation',
      goalIds: [objectives[s.objectiveIndex].goalId],
      content: { ...text, changesOutcome: false },
      status: 'approved',
      createdAt: daysAgo(now, 44),
      version: 1,
    })
  }
  // Each approved adaptation is used in several lessons, so the timeline and "Used in lessons" show real counts.
  const USAGE_DAYS = [43, 30, 12]
  const usage: UsageEvent[] = suggestions.flatMap((s, i) =>
    USAGE_DAYS.map((d, j) => ({ id: hexId('7e000000', letter, i * USAGE_DAYS.length + j + 1), suggestionId: s.id, approvedBy: USER_IDS.teacher, at: daysAgo(now, d) })),
  )

  let n = 0
  const dataPoints: DataPoint[] = []
  for (const s of plan.series) {
    const objective = objectives[s.objectiveIndex]
    const unit = objective.unit
    for (const [days, value] of s.points) {
      n++
      const withAdaptation = s.adaptation && days >= s.adaptationMinDays
      dataPoints.push({
        id: hexId('d9000000', letter, n),
        objectiveId: objective.id,
        value,
        unit,
        source: s.source,
        recorderId: s.recorder,
        recordedAt: daysAgo(now, days),
        classId: s.classId,
        lessonId: null,
        activeAdaptations: withAdaptation && s.adaptation ? [suggestionOf.get(s.adaptation) as string] : [],
        aiConfidence: s.source === 'photo' ? 0.95 : null,
        status: 'confirmed',
        sourceRef: s.source === 'photo' ? `photo:fixtures/sheet-${key}-${n}.jpg#item-1` : `ea_event:counter:${key}-${n}`,
        version: 1,
        supersedesId: null,
        reason: null,
        sessionDetail: null,
      })
    }
  }
  if (plan.pending) {
    const objective = objectives[plan.pending.objectiveIndex]
    n++
    dataPoints.push({
      id: hexId('d9000000', letter, n),
      objectiveId: objective.id,
      value: plan.pending.value,
      unit: objective.unit,
      source: 'photo',
      recorderId: USER_IDS.teacher,
      recordedAt: daysAgo(now, plan.pending.days),
      classId: CLASS_IDS.literacy,
      lessonId: null,
      activeAdaptations: [],
      aiConfidence: 0.41,
      status: 'pending_review',
      sourceRef: `photo:fixtures/sheet-${key}-pending.jpg#item-1`,
      version: 1,
      supersedesId: null,
      reason: null,
      sessionDetail: null,
    })
  }
  const decisions: Decision[] = plan.decisions.map((d, i) => ({
    id: hexId('de000000', letter, i + 1),
    objectiveId: objectives[d.objectiveIndex].id,
    rule: d.rule,
    firedAt: daysAgo(now, d.daysAgo),
    response: null,
    respondedBy: null,
    version: 1,
  }))
  const consents = [
    ...fixture.consents.map((c) => ({ ...c, grantedAt: daysAgo(now, 40) })),
    ...(plan.extraConsent && !fixture.consents.some((c) => c.kind === plan.extraConsent)
      ? [{ id: hexId('c0000000', letter, 9), kind: plan.extraConsent, grantedBy: USER_IDS.parentKai, recordedBy: USER_IDS.parentKai, grantedAt: daysAgo(now, 40), revokedAt: null, version: 1 }]
      : []),
  ]
  const proficiency = fixture.proficiency.map((p) => ({ ...p, setAt: daysAgo(now, 7) }))
  const reviewItems = dataPoints
    .filter((d) => d.status === 'pending_review')
    .map((d, i) => ({ id: hexId('ee000000', letter, i + 1), dataPointId: d.id, kind: 'low_confidence' as const, status: 'open' as const, createdAt: d.recordedAt, resolvedBy: null, resolvedAt: null, version: 1 }))
  const probes: Probe[] = key === 'kai' ? [kaiProbe(objectives[0].id, letter)] : []
  return {
    iep,
    probes,
    goals: fixture.goals,
    objectives,
    dataPoints,
    consents,
    proficiency,
    suggestions,
    usage,
    decisions,
    reviewItems,
    lensRun: { id: runId, lessonId, analysisId: hexId('a4000000', letter, 1), createdBy: USER_IDS.teacher, createdAt: daysAgo(now, 44) },
    hasRun: suggestions.length > 0,
  }
}

export function seedDemoStudent(sql: SqlExecutor, fixture: StudentFixture, now: string): void {
  const d = buildDemoStudent(fixture, now)
  sql.transaction(() => {
    insertRow(sql, 'iep_versions', toRow(d.iep))
    d.goals.forEach(({ exampleId: _e, ...g }) => insertRow(sql, 'goals', toRow(g)))
    d.objectives.forEach((o) => insertRow(sql, 'objectives', toRow(o)))
    if (d.hasRun) {
      insertRow(sql, 'lens_runs', toRow(d.lensRun))
      d.suggestions.forEach((s) => insertRow(sql, 'suggestions', toRow(s)))
      d.usage.forEach((u) => insertRow(sql, 'usage_events', toRow(u)))
    }
    d.probes.forEach((p) => insertRow(sql, 'probes', toRow(p)))
    d.dataPoints.forEach((p) => insertRow(sql, 'data_points', toRow(p, ['sessionDetail'])))
    d.reviewItems.forEach((r) => insertRow(sql, 'review_queue', toRow(r)))
    d.decisions.forEach((x) => insertRow(sql, 'decisions', toRow(x)))
    d.consents.forEach((c) => insertRow(sql, 'consents', toRow(c)))
    d.proficiency.forEach((p) => insertRow(sql, 'proficiency_ratings', toRow(p)))
    appendAudit(sql, { actorId: SEED_ACTOR, action: 'fixtures.seed', tableName: 'iep_versions', rowId: d.iep.id, at: now })
  })
}

/** Tables a reset keeps: the migration marker and the append-only audit trail. */
const KEEP_TABLES = new Set(['schema_version', 'audit_log'])

/** Dev only: deletes every demo row of a room (all tables except the audit trail). Retries so foreign keys never block. */
export function wipeRoom(sql: SqlExecutor): void {
  const tables = sql
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((r) => r.name)
    .filter((n) => !KEEP_TABLES.has(n))
  let pending = tables
  for (let pass = 0; pass < tables.length + 1 && pending.length > 0; pass++) {
    const failed: string[] = []
    for (const name of pending) {
      try {
        sql.run(`DELETE FROM "${name}"`)
      } catch {
        failed.push(name)
      }
    }
    pending = failed
  }
  if (pending.length > 0) throw new AltamiraError('bad_request', `could not clear ${pending.join(', ')}`)
}

/** Dev only: seeds one student room with dates relative to now. */
export const studentDevSeedDemo = defineOp({
  name: 'dev.seedDemo',
  room: 'student',
  args: z.object({ studentId: Id, now: z.string().optional(), reset: z.boolean().optional() }),
  run(sql, args) {
    const fixture = STUDENT_FIXTURES.find((f) => f.studentId === args.studentId)
    if (!fixture) throw new AltamiraError('not_found', `no fixture for student ${args.studentId}`)
    if (args.reset) wipeRoom(sql)
    else if (sql.get('SELECT 1 AS x FROM iep_versions LIMIT 1')) throw new AltamiraError('bad_request', 'student room is already seeded')
    seedDemoStudent(sql, fixture, args.now ?? new Date().toISOString())
    return { studentId: fixture.studentId, key: fixture.key }
  },
})

/** Demo lessons for today and tomorrow (school calendar), so Today View and Coming up have lessons. */
export function seedSchoolDemo(sql: SqlExecutor, now: string): void {
  const lessons: Lesson[] = [
    { id: DEMO_LESSON_IDS.salmon, classId: CLASS_IDS.literacy, title: 'Salmon life cycle (fictional lesson)', sourceKind: 'text', text: 'Read the short text about the salmon life cycle. Retell the main idea. Then write two sentences about one stage.', scheduledFor: SCHOOL_DATE.format(new Date(now)), createdBy: USER_IDS.teacher, createdAt: daysAgo(now, 1), version: 1 },
    { id: DEMO_LESSON_IDS.counting, classId: CLASS_IDS.numeracy, title: 'Counting and adding to 20 (fictional lesson)', sourceKind: 'text', text: 'Use cubes to make groups. Count each group. Add two groups together and say how many in all.', scheduledFor: SCHOOL_DATE.format(new Date(daysAhead(now, 1))), createdBy: USER_IDS.teacher, createdAt: daysAgo(now, 1), version: 1 },
  ]
  sql.transaction(() => {
    lessons.forEach((l) => insertRow(sql, 'lessons', toRow(l)))
    appendAudit(sql, { actorId: SEED_ACTOR, action: 'fixtures.seed', tableName: 'lessons', rowId: '*', at: now })
  })
}

/**
 * Dev only: with {reset:true} wipes the school room and reloads it. Otherwise "Act as student" links the caller to Kai as a staff-style
 * membership, so POST /students/:id/sessions (evidence.capture) is in scope
 * for his student-mode consent. Run after the role switch.
 */
export const devLinkStudent = defineOp({
  name: 'dev.linkStudent',
  room: 'school',
  args: z.object({ reset: z.boolean().optional() }),
  run(sql, args, actor) {
    const at = new Date().toISOString()
    if (args.reset) {
      // Dev reset of the school room: clear it and load the fictional school again (the route then re-seeds the students).
      wipeRoom(sql)
      seedSchool(sql)
      seedSchoolDemo(sql, at)
      return { studentId: STUDENT_IDS.kai }
    }
    sql.run('DELETE FROM parent_links WHERE parent_user_id = ?', actor.userId)
    sql.run("DELETE FROM memberships WHERE user_id = ? AND role = 'ea'", actor.userId)
    insertRow(
      sql,
      'memberships',
      toRow({ id: crypto.randomUUID(), userId: actor.userId, role: 'ea', studentId: STUDENT_IDS.kai, classId: null, districtId: null, createdAt: at, version: 1 }),
    )
    appendAudit(sql, { actorId: actor.userId, action: 'dev.linkStudent', tableName: 'memberships', rowId: actor.userId, after: { studentId: STUDENT_IDS.kai }, at })
    return { studentId: STUDENT_IDS.kai }
  },
})
