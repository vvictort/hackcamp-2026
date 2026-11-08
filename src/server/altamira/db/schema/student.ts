import {
  ADAPTATION_TYPES,
  CHECK_STATUSES,
  CONSENT_KINDS,
  DATA_POINT_SOURCES,
  DATA_POINT_STATUSES,
  DECISION_RULES,
  DRAFT_STATUSES,
  FAMILY_SUMMARY_STATUSES,
  GAP_TYPES,
  GOAL_STATUSES,
  LABELS,
  METRIC_TYPES,
  OBJECTIVE_STATUSES,
  PROFICIENCY_LEVELS,
  PROPOSAL_STATUSES,
  PROPOSAL_TARGETS,
  REVIEW_KINDS,
  REVIEW_STATUSES,
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
} from '../../contract/enums'
import { sqlList as l } from '../mapping'
import { AUDIT_LOG_DDL, runMigrations, type Migration } from '../migrate'
import type { SqlExecutor } from '../sql'

/**
 * AltamiraStudentRoom schema (design doc "Data model", student room).
 * Every mutable table has `version INTEGER` for optimistic locking
 * (iep_versions uses row_version because `version` is the IEP number).
 * audit_log is append-only through triggers.
 */
export const STUDENT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS iep_versions (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL UNIQUE,
    sections_json TEXT NOT NULL,
    modification_subjects_json TEXT NOT NULL DEFAULT '[]',
    source_file_key TEXT,
    imported_by TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    confirmed_by TEXT,
    confirmed_at TEXT,
    row_version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    iep_version INTEGER NOT NULL REFERENCES iep_versions (version),
    area TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (${l(GOAL_STATUSES)})),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS objectives (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals (id),
    metric_type TEXT NOT NULL CHECK (metric_type IN (${l(METRIC_TYPES)})),
    unit TEXT NOT NULL,
    baseline REAL,
    baseline_method TEXT,
    target REAL NOT NULL,
    mastery_rule TEXT NOT NULL,
    review_date TEXT,
    capture_method TEXT NOT NULL CHECK (capture_method IN (${l(DATA_POINT_SOURCES)})),
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (${l(OBJECTIVE_STATUSES)})),
    flag_reason TEXT,
    confirmed_by TEXT,
    confirmed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  'CREATE INDEX IF NOT EXISTS objectives_goal ON objectives (goal_id)',
  `CREATE TABLE IF NOT EXISTS lens_runs (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL,
    analysis_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS lens_runs_lesson ON lens_runs (lesson_id)',
  `CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    lens_run_id TEXT NOT NULL REFERENCES lens_runs (id),
    kind TEXT NOT NULL CHECK (kind IN (${l(SUGGESTION_KINDS)})),
    gap_type TEXT CHECK (gap_type IN (${l(GAP_TYPES)})),
    adaptation_type TEXT CHECK (adaptation_type IN (${l(ADAPTATION_TYPES)})),
    label TEXT CHECK (label IN (${l(LABELS)})),
    goal_ids_json TEXT NOT NULL DEFAULT '[]',
    content_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (${l(SUGGESTION_STATUSES)})),
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK ((kind = 'gap' AND gap_type IS NOT NULL) OR (kind = 'adaptation' AND adaptation_type IS NOT NULL AND label IS NOT NULL))
  )`,
  'CREATE INDEX IF NOT EXISTS suggestions_run ON suggestions (lens_run_id)',
  `CREATE TABLE IF NOT EXISTS checks (
    id TEXT PRIMARY KEY,
    suggestion_id TEXT NOT NULL REFERENCES suggestions (id),
    objective_id TEXT NOT NULL REFERENCES objectives (id),
    items_json TEXT NOT NULL,
    answer_key_json TEXT,
    rubric_json TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (${l(CHECK_STATUSES)})),
    version INTEGER NOT NULL DEFAULT 1,
    CHECK (answer_key_json IS NOT NULL OR rubric_json IS NOT NULL)
  )`,
  `CREATE TABLE IF NOT EXISTS probes (
    id TEXT PRIMARY KEY,
    objective_id TEXT NOT NULL REFERENCES objectives (id),
    skill TEXT NOT NULL,
    level TEXT NOT NULL,
    form_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS data_points (
    id TEXT PRIMARY KEY,
    objective_id TEXT NOT NULL REFERENCES objectives (id),
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN (${l(DATA_POINT_SOURCES)})),
    recorder_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    class_id TEXT,
    lesson_id TEXT,
    active_adaptations_json TEXT NOT NULL DEFAULT '[]',
    ai_confidence REAL CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
    status TEXT NOT NULL CHECK (status IN (${l(DATA_POINT_STATUSES)})),
    source_ref TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    supersedes_id TEXT REFERENCES data_points (id),
    reason TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS data_points_objective ON data_points (objective_id, recorded_at)',
  'CREATE INDEX IF NOT EXISTS data_points_status ON data_points (status)',
  `CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    data_point_id TEXT NOT NULL REFERENCES data_points (id),
    kind TEXT NOT NULL CHECK (kind IN (${l(REVIEW_KINDS)})),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (${l(REVIEW_STATUSES)})),
    created_at TEXT NOT NULL,
    resolved_by TEXT,
    resolved_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  'CREATE INDEX IF NOT EXISTS review_queue_status ON review_queue (status)',
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    objective_id TEXT NOT NULL REFERENCES objectives (id),
    rule TEXT NOT NULL CHECK (rule IN (${l(DECISION_RULES)})),
    fired_at TEXT NOT NULL,
    response TEXT,
    responded_by TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    suggestion_id TEXT NOT NULL REFERENCES suggestions (id),
    approved_by TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL CHECK (target IN (${l(PROPOSAL_TARGETS)})),
    change_json TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    proposed_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (${l(PROPOSAL_STATUSES)})),
    resolved_by TEXT,
    resolved_at TEXT,
    resolution_note TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS parent_inputs (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    text TEXT NOT NULL,
    language TEXT NOT NULL,
    created_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN (${l(CONSENT_KINDS)})),
    granted_by TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS proficiency_ratings (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals (id),
    level TEXT NOT NULL CHECK (level IN (${l(PROFICIENCY_LEVELS)})),
    period TEXT NOT NULL,
    narrative TEXT,
    set_by TEXT NOT NULL,
    set_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS progress_drafts (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals (id),
    period TEXT NOT NULL,
    due_date TEXT,
    sentences_json TEXT NOT NULL DEFAULT '[]',
    proficiency_suggestion TEXT CHECK (proficiency_suggestion IN (${l(PROFICIENCY_LEVELS)})),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (${l(DRAFT_STATUSES)})),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT,
    used_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS draft_citations (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES progress_drafts (id),
    sentence_index INTEGER NOT NULL CHECK (sentence_index >= 0),
    data_point_id TEXT NOT NULL REFERENCES data_points (id)
  )`,
  'CREATE INDEX IF NOT EXISTS draft_citations_draft ON draft_citations (draft_id)',
  `CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    to_school TEXT,
    packet_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS family_summaries (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES progress_drafts (id),
    language TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (${l(FAMILY_SUMMARY_STATUSES)})),
    created_at TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  ...AUDIT_LOG_DDL,
]

/** v2: student-mode time on task and read-aloud use on each data point (PRD 1B "Capture sources"). */
export const STUDENT_V2: string[] = ['ALTER TABLE data_points ADD COLUMN session_detail_json TEXT']

export const STUDENT_MIGRATIONS: readonly Migration[] = [STUDENT_DDL, STUDENT_V2]

export const migrateStudent = (sql: SqlExecutor): number => runMigrations(sql, STUDENT_MIGRATIONS)

/** Alias so every schema module exposes migrate(sql). */
export const migrate = migrateStudent
