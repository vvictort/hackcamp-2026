import { afterEach, describe, expect, it } from 'vitest'
import * as school from '../contract/school'
import * as student from '../contract/student'
import { fromRow } from '../db/mapping'
import { createNodeSqlExecutor } from '../db/node-sqlite'
import { migrateSchool } from '../db/schema/school'
import { migrateStudent } from '../db/schema/student'
import {
  CBIEP_SAMPLE_EXPECTED,
  CBIEP_SAMPLE_TEXT,
  CLASSES,
  MEMBERSHIPS,
  PARENT_LINKS,
  ROSTER,
  SCHEDULE_BLOCKS,
  SCHOOL_STUDENTS,
  STUDENT_FIXTURES,
  USERS,
  USER_IDS,
  buildDemoStudent,
  seedDemoStudent,
  seedSchool,
  seedStudent,
} from './index'
import { FIXTURE_NAMES } from '../e2e/testing'

const dbs: { close(): void }[] = []
afterEach(() => dbs.splice(0).forEach((d) => d.close()))
const fresh = () => {
  const db = createNodeSqlExecutor()
  dbs.push(db)
  return db
}

describe('fixtures parse against the contract', () => {
  it('school room fixtures', () => {
    USERS.forEach((u) => school.User.parse(u))
    SCHOOL_STUDENTS.forEach((s) => school.SchoolStudent.parse(s))
    CLASSES.forEach((c) => school.SchoolClass.parse(c))
    MEMBERSHIPS.forEach((m) => school.Membership.parse(m))
    PARENT_LINKS.forEach((p) => school.ParentLink.parse(p))
    ROSTER.forEach((r) => school.RosterEntry.parse(r))
    SCHEDULE_BLOCKS.forEach((b) => school.ScheduleBlock.parse(b))
  })

  it('student room fixtures', () => {
    for (const f of STUDENT_FIXTURES) {
      student.IepVersion.parse(f.iep)
      f.goals.forEach((g) => student.Goal.parse(g))
      f.objectives.forEach((o) => student.Objective.parse(o))
      f.dataPoints.forEach((d) => student.DataPoint.parse(d))
      f.consents.forEach((c) => student.Consent.parse(c))
      f.proficiency.forEach((p) => student.ProficiencyRating.parse(p))
    }
  })

  it('has three CB-IEP students, one with a modified math program authorized in the IEP', () => {
    expect(STUDENT_FIXTURES).toHaveLength(3)
    const modified = STUDENT_FIXTURES.filter((f) => f.iep.modificationSubjects.includes('math'))
    expect(modified.map((f) => f.key)).toEqual(['sofia'])
    expect(CLASSES.find((c) => c.name === 'Numeracy')?.subject).toBe('math')
  })

  it('has staff for every role', () => {
    const roles = new Set(MEMBERSHIPS.map((m) => m.role))
    expect([...roles].sort()).toEqual(['case_manager', 'district_lead', 'ea', 'school_admin', 'teacher'])
    expect(PARENT_LINKS).toHaveLength(3)
  })

  it('mixes data point statuses so parent filters can be tested', () => {
    const statuses = new Set(STUDENT_FIXTURES.flatMap((f) => f.dataPoints.map((d) => d.status)))
    expect([...statuses].sort()).toEqual(['auto_confirmed', 'confirmed', 'pending_review'])
  })

  it('CB-IEP sample text contains every expected field', () => {
    const s = CBIEP_SAMPLE_EXPECTED
    student.IepSections.parse(s)
    for (const text of [
      s.student.firstName,
      s.student.lastName,
      ...s.goals.map((g) => g.text),
      ...s.accommodations,
      ...s.supports,
      ...s.profile.strengths,
    ]) {
      expect(CBIEP_SAMPLE_TEXT).toContain(text)
    }
  })

  it('lists fixture names for the de-identification scan, including unaccented forms', () => {
    expect(FIXTURE_NAMES).toEqual(expect.arrayContaining(['Kai', 'Nakamura', 'Sofía', 'Sofia', 'Leila', 'Ahmadi']))
  })
})

describe('seeding', () => {
  it('loads the school room', () => {
    const db = fresh()
    migrateSchool(db)
    seedSchool(db)
    expect(db.get('SELECT COUNT(*) AS n FROM memberships')).toEqual({ n: MEMBERSHIPS.length })
    const rows = db.all<Record<string, unknown>>('SELECT * FROM memberships WHERE user_id = ?', USER_IDS.ea)
    expect(rows.map((r) => school.Membership.parse(fromRow(r)).studentId)).toHaveLength(2)
  })

  it('loads each student room and reads entities back unchanged', () => {
    for (const f of STUDENT_FIXTURES) {
      const db = fresh()
      migrateStudent(db)
      seedStudent(db, f)
      const iep = student.IepVersion.parse(fromRow(db.get<Record<string, unknown>>('SELECT * FROM iep_versions')!))
      expect(iep).toEqual(f.iep)
      const points = db.all<Record<string, unknown>>('SELECT * FROM data_points ORDER BY id').map((r) => student.DataPoint.parse(fromRow(r)))
      expect(points).toEqual([...f.dataPoints].sort((a, b) => a.id.localeCompare(b.id)))
      expect(db.get('SELECT COUNT(*) AS n FROM audit_log')).toEqual({ n: 1 })
    }
  })
})

describe('demo layer', () => {
  const now = '2026-11-08T12:00:00.000Z'
  it('seeds a probe with an answer key for a confirmed objective of Kai only', () => {
    const [kai, amara, sofia] = ['kai', 'amara', 'sofia'].map((k) => buildDemoStudent(STUDENT_FIXTURES.find((f) => f.key === k)!, now))
    expect(amara.probes).toEqual([])
    expect(sofia.probes).toEqual([])
    expect(kai.probes).toHaveLength(1)
    const probe = student.Probe.parse(kai.probes[0])
    expect(kai.objectives.find((o) => o.id === probe.objectiveId)?.status).toBe('confirmed')
    expect(probe.form.answerKey.map((k) => k.itemId).sort()).toEqual(probe.form.items.map((i) => i.id).sort())
  })

  it('gives each student enough non-teacher confirmed points with adaptations for what-works', () => {
    for (const f of STUDENT_FIXTURES) {
      const d = buildDemoStudent(f, now)
      const used = d.dataPoints.filter((p) => p.status === 'confirmed' && p.source !== 'teacher' && p.activeAdaptations.length > 0)
      expect(used.length).toBeGreaterThanOrEqual(5)
      expect(d.usage.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('inserts the probe into the room', () => {
    const db = fresh()
    migrateStudent(db)
    seedDemoStudent(db, STUDENT_FIXTURES.find((f) => f.key === 'kai')!, now)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM probes')?.n).toBe(1)
  })
})
