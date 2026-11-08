import {
  CAPTURE_BATCH_STATUSES,
  LESSON_SOURCE_KINDS,
  MEMBERSHIP_ROLES,
  SHARE_TOKEN_KINDS,
} from '../../contract/enums'
import { sqlList as l } from '../mapping'
import { AUDIT_LOG_DDL, runMigrations, type Migration } from '../migrate'
import type { SqlExecutor } from '../sql'

/** AltamiraSchoolRoom schema (design doc "Data model", school room). No student names here. */
export const SCHOOL_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    display_token TEXT NOT NULL UNIQUE,
    grade TEXT NOT NULL,
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    role TEXT NOT NULL CHECK (role IN (${l(MEMBERSHIP_ROLES)})),
    student_id TEXT REFERENCES students (id),
    class_id TEXT REFERENCES classes (id),
    district_id TEXT,
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK (
      (role IN ('case_manager', 'ea') AND student_id IS NOT NULL AND class_id IS NULL) OR
      (role = 'teacher' AND class_id IS NOT NULL AND student_id IS NULL) OR
      (role = 'school_admin' AND student_id IS NULL AND class_id IS NULL) OR
      (role = 'district_lead' AND student_id IS NULL AND class_id IS NULL AND district_id IS NOT NULL)
    )
  )`,
  'CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS memberships_unique ON memberships (user_id, role, IFNULL(student_id, \'\'), IFNULL(class_id, \'\'))',
  `CREATE TABLE IF NOT EXISTS parent_links (
    id TEXT PRIMARY KEY,
    parent_user_id TEXT NOT NULL REFERENCES users (id),
    student_id TEXT NOT NULL REFERENCES students (id),
    created_at TEXT NOT NULL,
    UNIQUE (parent_user_id, student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS student_team (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students (id),
    user_id TEXT NOT NULL REFERENCES users (id),
    team_role TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roster (
    class_id TEXT NOT NULL REFERENCES classes (id),
    student_id TEXT NOT NULL REFERENCES students (id),
    PRIMARY KEY (class_id, student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS schedule_blocks (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes (id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes (id),
    title TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN (${l(LESSON_SOURCE_KINDS)})),
    text TEXT,
    scheduled_for TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS lesson_files (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons (id),
    storage_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // PRD 1A-2: one cached analysis per lesson.
  `CREATE TABLE IF NOT EXISTS lesson_analyses (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL UNIQUE REFERENCES lessons (id),
    analysis_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sheet_codes (
    code TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students (id),
    lesson_id TEXT NOT NULL REFERENCES lessons (id),
    check_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS share_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN (${l(SHARE_TOKEN_KINDS)})),
    student_id TEXT NOT NULL REFERENCES students (id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS capture_batches (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN (${l(CAPTURE_BATCH_STATUSES)})),
    pages_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1
  )`,
  ...AUDIT_LOG_DDL,
]

export const SCHOOL_MIGRATIONS: readonly Migration[] = [SCHOOL_DDL]

export const migrateSchool = (sql: SqlExecutor): number => runMigrations(sql, SCHOOL_MIGRATIONS)

/** Alias so every schema module exposes migrate(sql). */
export const migrate = migrateSchool
