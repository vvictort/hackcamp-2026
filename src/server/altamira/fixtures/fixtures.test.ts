import { afterEach, describe, expect, it } from 'vitest'
import { CLASSES as EXAMPLE_CLASSES, studentById } from '../../../components/altamira/exampleData'
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
  FIXTURE_NAMES,
  MEMBERSHIPS,
  PARENT_LINKS,
  ROSTER,
  SCHEDULE_BLOCKS,
  SCHOOL_STUDENTS,
  STUDENT_FIXTURES,
  USERS,
  USER_IDS,
  seedSchool,
  seedStudent,
} from './index'

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

describe('fixtures match the frontend example data', () => {
  it('same names and goal wording', () => {
    for (const f of STUDENT_FIXTURES) {
      const example = studentById(f.exampleId)
      expect(`${f.iep.sections.student.firstName} ${f.iep.sections.student.lastName}`).toBe(example.name)
      expect(f.goals.map((g) => [g.exampleId, g.area, g.text])).toEqual(example.goals.map((g) => [g.id, g.area, g.text]))
    }
  })

  it('same class rosters, without the frontend-only student', () => {
    const idByExample = Object.fromEntries(STUDENT_FIXTURES.map((f) => [f.exampleId, f.studentId]))
    for (const block of EXAMPLE_CLASSES) {
      const cls = CLASSES.find((c) => c.name === block.subject)
      expect(cls, block.subject).toBeDefined()
      const expected = block.studentIds.filter((id) => id in idByExample).map((id) => idByExample[id]).sort()
      const actual = ROSTER.filter((r) => r.classId === cls!.id).map((r) => r.studentId).sort()
      expect(actual, block.subject).toEqual(expected)
    }
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
