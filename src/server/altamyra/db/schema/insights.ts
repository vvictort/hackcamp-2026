import { GOAL_PROGRESS, LABELS, PROFICIENCY_LEVELS, REVIEW_TIMELINESS } from '../../contract/enums'
import { sqlList as l } from '../mapping'
import { runMigrations, type Migration } from '../migrate'
import type { SqlExecutor } from '../../contract/ops'

/**
 * AltamyraInsightsRoom schema: de-identified counters only. Reads must group by
 * the chosen dimensions and suppress any group with COUNT(DISTINCT student_key) < 10.
 */
export const INSIGHTS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS counters (
    id TEXT PRIMARY KEY,
    district_id TEXT NOT NULL,
    school_id TEXT NOT NULL,
    period TEXT NOT NULL,
    student_key TEXT NOT NULL,
    goal_area TEXT,
    proficiency_level TEXT CHECK (proficiency_level IN (${l(PROFICIENCY_LEVELS)})),
    label TEXT CHECK (label IN (${l(LABELS)})),
    review_timeliness TEXT CHECK (review_timeliness IN (${l(REVIEW_TIMELINESS)})),
    count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  // One row per student per dimension combination; increments update count.
  `CREATE UNIQUE INDEX IF NOT EXISTS counters_key ON counters (
    district_id, school_id, period, student_key,
    IFNULL(goal_area, ''), IFNULL(proficiency_level, ''), IFNULL(label, ''), IFNULL(review_timeliness, '')
  )`,
]

/** v2: goal progress dimension (PRD District Insights "anonymized goal progress"); the key index includes it. */
export const INSIGHTS_V2: string[] = [
  `ALTER TABLE counters ADD COLUMN goal_progress TEXT CHECK (goal_progress IN (${l(GOAL_PROGRESS)}))`,
  'DROP INDEX IF EXISTS counters_key',
  `CREATE UNIQUE INDEX counters_key ON counters (
    district_id, school_id, period, student_key,
    IFNULL(goal_area, ''), IFNULL(proficiency_level, ''), IFNULL(label, ''), IFNULL(review_timeliness, ''), IFNULL(goal_progress, '')
  )`,
]

export const INSIGHTS_MIGRATIONS: readonly Migration[] = [INSIGHTS_DDL, INSIGHTS_V2]

export const migrateInsights = (sql: SqlExecutor): number => runMigrations(sql, INSIGHTS_MIGRATIONS)

/** Alias so every schema module exposes migrate(sql). */
export const migrate = migrateInsights
