import { afterEach, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { Counter } from '../contract/insights'
import * as school from '../contract/school'
import * as student from '../contract/student'
import { appendAudit } from './audit'
import { fromRow, insertRow, toRow } from './mapping'
import { schemaVersion } from './migrate'
import { createNodeSqlExecutor } from './node-sqlite'
import { INSIGHTS_DDL, migrateInsights } from './schema/insights'
import { SCHOOL_DDL, migrateSchool } from './schema/school'
import { STUDENT_DDL, STUDENT_MIGRATIONS, migrateStudent } from './schema/student'

const open: { close(): void }[] = []
function freshDb() {
  const db = createNodeSqlExecutor()
  open.push(db)
  return db
}
afterEach(() => open.splice(0).forEach((db) => db.close()))

const tables = (db: ReturnType<typeof freshDb>) =>
  db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((r) => r.name)

describe('migrations on node:sqlite', () => {
  it('create every student, school and insights table, and are idempotent', () => {
    const s = freshDb()
    expect(migrateStudent(s)).toBe(STUDENT_MIGRATIONS.length)
    expect(migrateStudent(s)).toBe(STUDENT_MIGRATIONS.length)
    expect(schemaVersion(s)).toBe(STUDENT_MIGRATIONS.length)
    expect(tables(s)).toEqual([...student.STUDENT_TABLES, 'schema_version'].sort())

    const sc = freshDb()
    migrateSchool(sc)
    migrateSchool(sc)
    expect(tables(sc)).toEqual([...school.SCHOOL_TABLES, 'schema_version'].sort())

    const i = freshDb()
    migrateInsights(i)
    expect(tables(i)).toEqual(['counters', 'schema_version'])
  })

  it('every DDL entry is a single statement', () => {
    for (const stmt of [...STUDENT_DDL, ...SCHOOL_DDL, ...INSIGHTS_DDL]) {
      expect(stmt.trim().endsWith(';')).toBe(false)
    }
  })
})

/** Columns implied by a contract schema under the mapping convention. */
type AnySchema = z.ZodType & { def: { type: string; innerType?: AnySchema } }
function expectedColumns(schema: z.ZodObject): string[] {
  const jsonTypes = new Set(['object', 'array', 'record', 'unknown'])
  return Object.entries(schema.shape as Record<string, AnySchema>)
    .map(([key, field]) => {
      let t = field
      while (t.def.innerType) t = t.def.innerType
      const col = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
      return jsonTypes.has(t.def.type) ? `${col}_json` : col
    })
    .sort()
}

describe('DDL matches the contract schemas', () => {
  const studentTables: Record<string, z.ZodObject> = {
    iep_versions: student.IepVersion,
    goals: student.Goal,
    objectives: student.Objective,
    lens_runs: student.LensRun,
    suggestions: student.GapSuggestion,
    checks: student.Check,
    probes: student.Probe,
    data_points: student.DataPoint,
    review_queue: student.ReviewItem,
    decisions: student.Decision,
    usage_events: student.UsageEvent,
    consents: student.Consent,
    proficiency_ratings: student.ProficiencyRating,
    family_summaries: student.FamilySummary,
    audit_log: student.AuditEntry,
  }
  const schoolTables: Record<string, z.ZodObject> = {
    users: school.User,
    memberships: school.Membership,
    parent_links: school.ParentLink,
    students: school.SchoolStudent,
    student_team: school.StudentTeamMember,
    classes: school.SchoolClass,
    roster: school.RosterEntry,
    schedule_blocks: school.ScheduleBlock,
    lessons: school.Lesson,
    lesson_files: school.LessonFile,
    lesson_analyses: school.LessonAnalysis,
    sheet_codes: school.SheetCode,
    capture_batches: school.CaptureBatch,
  }

  const check = (db: ReturnType<typeof freshDb>, map: Record<string, z.ZodObject>) => {
    for (const [table, schema] of Object.entries(map)) {
      const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name).sort()
      expect(cols, table).toEqual(expectedColumns(schema))
    }
  }

  it('student room', () => {
    const db = freshDb()
    migrateStudent(db)
    expect(Object.keys(studentTables).sort()).toEqual([...student.STUDENT_TABLES].sort())
    check(db, studentTables)
  })

  it('school room', () => {
    const db = freshDb()
    migrateSchool(db)
    expect([...Object.keys(schoolTables), 'audit_log'].sort()).toEqual([...school.SCHOOL_TABLES].sort())
    check(db, schoolTables)
  })

  it('insights room', () => {
    const db = freshDb()
    migrateInsights(db)
    check(db, { counters: Counter })
  })

  it('every mutable student table has a version column', () => {
    const db = freshDb()
    migrateStudent(db)
    const appendOnly = new Set(['lens_runs', 'probes', 'usage_events', 'proficiency_ratings', 'draft_citations', 'handoffs', 'audit_log'])
    for (const table of student.STUDENT_TABLES.filter((t) => !appendOnly.has(t))) {
      const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name)
      expect(cols.includes('version') || cols.includes('row_version'), table).toBe(true)
    }
  })
})

describe('audit_log is append-only (PRD NFR Security)', () => {
  for (const [name, migrate] of [
    ['student', migrateStudent],
    ['school', migrateSchool],
  ] as const) {
    it(`${name} room rejects UPDATE and DELETE`, () => {
      const db = freshDb()
      migrate(db)
      const id = appendAudit(db, { actorId: 'u-1', action: 'test', tableName: 'goals', rowId: 'g-1', after: { a: 1 } })
      expect(() => db.run("UPDATE audit_log SET action = 'x' WHERE id = ?", id)).toThrow(/append-only/)
      expect(() => db.run('DELETE FROM audit_log WHERE id = ?', id)).toThrow(/append-only/)
      expect(() => db.run('DELETE FROM audit_log')).toThrow(/append-only/)
      const row = db.get<Record<string, unknown>>('SELECT * FROM audit_log WHERE id = ?', id)
      expect(student.AuditEntry.parse(fromRow(row!))).toMatchObject({ action: 'test', after: { a: 1 }, before: null })
    })
  }
})

describe('transactions', () => {
  const goal = (id: string) =>
    toRow({ id, iepVersion: 1, area: 'Reading', text: 'Retell the main idea', status: 'active', version: 1 })
  const iep = toRow({
    id: 'iep-1',
    version: 1,
    sections: { any: 'thing' },
    modificationSubjects: [],
    sourceFileKey: null,
    importedBy: 'u-cm',
    importedAt: '2026-09-10T00:00:00.000Z',
    confirmedBy: null,
    confirmedAt: null,
    rowVersion: 1,
  })

  it('a throw rolls back the write and its audit row together', () => {
    const db = freshDb()
    migrateStudent(db)
    insertRow(db, 'iep_versions', iep)
    expect(() =>
      db.transaction(() => {
        insertRow(db, 'goals', goal('g-1'))
        appendAudit(db, { actorId: 'u-cm', action: 'goal.create', tableName: 'goals', rowId: 'g-1' })
        throw new Error('injected failure')
      }),
    ).toThrow('injected failure')
    expect(db.get('SELECT COUNT(*) AS n FROM goals')).toEqual({ n: 0 })
    expect(db.get('SELECT COUNT(*) AS n FROM audit_log')).toEqual({ n: 0 })
  })

  it('commits on success and supports nesting with inner rollback', () => {
    const db = freshDb()
    migrateStudent(db)
    insertRow(db, 'iep_versions', iep)
    db.transaction(() => {
      insertRow(db, 'goals', goal('g-1'))
      expect(() =>
        db.transaction(() => {
          insertRow(db, 'goals', goal('g-2'))
          throw new Error('inner')
        }),
      ).toThrow('inner')
    })
    expect(db.all<{ id: string }>('SELECT id FROM goals').map((r) => r.id)).toEqual(['g-1'])
  })

  it('refuses async callbacks', () => {
    const db = freshDb()
    migrateStudent(db)
    expect(() => db.transaction(() => Promise.resolve(1))).toThrow(/synchronous/)
  })

  it('run reports changes', () => {
    const db = freshDb()
    migrateStudent(db)
    insertRow(db, 'iep_versions', iep)
    insertRow(db, 'goals', goal('g-1'))
    const res = db.run("UPDATE goals SET status = 'closed', version = version + 1 WHERE id = ? AND version = ?", 'g-1', 1)
    expect(res.changes).toBe(1)
    expect(db.run('UPDATE goals SET version = version + 1 WHERE id = ? AND version = ?', 'g-1', 1).changes).toBe(0)
  })
})

describe('constraints', () => {
  it('rejects values outside contract enums and enforces foreign keys', () => {
    const db = freshDb()
    migrateStudent(db)
    expect(() => insertRow(db, 'goals', toRow({ id: 'g', iepVersion: 9, area: 'a', text: 't', status: 'active' }))).toThrow(
      /FOREIGN KEY/,
    )
    expect(() =>
      db.run(
        "INSERT INTO consents (id, kind, granted_by, recorded_by, granted_at) VALUES ('c', 'student_mode', 'p', 'p', '2026-01-01')",
      ),
    ).toThrow(/CHECK/)
  })

  it('allows only one cached analysis per lesson (PRD 1A-2)', () => {
    const db = freshDb()
    migrateSchool(db)
    db.run("INSERT INTO classes (id, name, subject, grade) VALUES ('c1', 'Numeracy', 'math', '4')")
    db.run(
      "INSERT INTO lessons (id, class_id, title, source_kind, created_by, created_at) VALUES ('l1', 'c1', 'Arrays', 'text', 'u', 'now')",
    )
    const add = (id: string) =>
      db.run(
        "INSERT INTO lesson_analyses (id, lesson_id, analysis_json, provider, created_at) VALUES (?, 'l1', '{}', 'fixture', 'now')",
        id,
      )
    add('a1')
    expect(() => add('a2')).toThrow(/UNIQUE/)
  })
})

describe('mapping', () => {
  it('round-trips camelCase entities through snake_case rows', () => {
    const entity = {
      id: 'c1',
      suggestionId: 's1',
      objectiveId: 'o1',
      items: [{ id: 'i1', prompt: '3 + 4', format: 'numeric', options: null }],
      answerKey: null,
      rubric: { criteria: [{ id: 'c', description: 'd' }], levels: [{ score: 0, description: 'a' }, { score: 1, description: 'b' }] },
      status: 'active',
      version: 1,
    }
    const row = toRow(entity, ['answerKey'])
    expect(Object.keys(row).sort()).toEqual(
      ['id', 'suggestion_id', 'objective_id', 'items_json', 'answer_key_json', 'rubric_json', 'status', 'version'].sort(),
    )
    expect(student.Check.parse(fromRow(row))).toEqual(entity)
  })

  it('refuses boolean columns', () => {
    expect(() => toRow({ flag: true })).toThrow(/boolean/)
  })
})

describe('v3 upgrade of an existing student room', () => {
  it('keeps summaries, maps audio consent to voice_note, drops removed-feature tables', () => {
    const db = freshDb()
    // A room as it was before v3: DDL v1 with the old tables and consent kinds, then v2.
    for (const stmt of [
      'CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
      'CREATE TABLE progress_drafts (id TEXT PRIMARY KEY)',
      'CREATE TABLE proposals (id TEXT PRIMARY KEY)',
      'CREATE TABLE parent_inputs (id TEXT PRIMARY KEY)',
      'CREATE TABLE draft_citations (id TEXT PRIMARY KEY)',
      'CREATE TABLE handoffs (id TEXT PRIMARY KEY)',
      "CREATE TABLE consents (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('student_mode', 'audio')), granted_by TEXT NOT NULL, recorded_by TEXT NOT NULL, granted_at TEXT NOT NULL, revoked_at TEXT, version INTEGER NOT NULL DEFAULT 1)",
      "CREATE TABLE family_summaries (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES progress_drafts (id), language TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, approved_by TEXT, approved_at TEXT, version INTEGER NOT NULL DEFAULT 1)",
    ]) db.run(stmt)
    db.run('INSERT INTO schema_version (id, version) VALUES (1, 2)')
    db.run("INSERT INTO consents VALUES ('c1', 'student_mode', 'p', 'p', '2026-10-01T00:00:00.000Z', NULL, 1), ('c2', 'audio', 'p', 'p', '2026-10-01T00:00:00.000Z', NULL, 1)")
    db.run("INSERT INTO progress_drafts VALUES ('d1')")
    db.run("INSERT INTO family_summaries VALUES ('f1', 'd1', 'en', 'Hello', 'approved', '2026-10-01T00:00:00.000Z', 'u', '2026-10-02T00:00:00.000Z', 2)")
    expect(migrateStudent(db)).toBe(STUDENT_MIGRATIONS.length)
    expect(db.all<{ id: string; kind: string }>('SELECT id, kind FROM consents')).toEqual([{ id: 'c2', kind: 'voice_note' }])
    expect(db.get<{ text: string; version: number }>('SELECT text, version FROM family_summaries WHERE id = ?', 'f1')).toEqual({ text: 'Hello', version: 2 })
    expect(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('progress_drafts','proposals','parent_inputs','draft_citations','handoffs')")).toEqual([])
  })
})
