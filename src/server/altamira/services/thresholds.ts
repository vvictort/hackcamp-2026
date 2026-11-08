/**
 * Every tunable rule default in one place (design doc "Analytics, decision
 * rules and jobs": provisional defaults as named constants so the pilot can
 * retune them in one file). Values marked "assumption" are not stated in the
 * PRD; they are the smallest workable choice and are listed in the report.
 */

const DAY_MS = 24 * 60 * 60 * 1000
export const daysToMs = (days: number) => days * DAY_MS

// ---------- goal status line (PRD 1B "Analytics per goal") ----------

/** Baseline = median of the first 3 data points. */
export const BASELINE_POINTS = 3
/** Current level = median of the last 3 data points. */
export const CURRENT_POINTS = 3
/** "How much recent data supports it": points in this many days. */
export const RECENT_WINDOW_DAYS = 14

// ---------- decision rules (PRD 1B "Decision rules", provisional) ----------

/** No decision rule fires below 6 points ... */
export const DECISION_MIN_POINTS = 6
/** ... or across less than 3 weeks. */
export const DECISION_MIN_DAYS = 21
/** With 6 to 7 points, the four most recent points are compared with the aimline. */
export const DECISION_RECENT_POINTS = 4
/** With 8 or more points, the trend line is compared with the aimline. */
export const DECISION_TREND_MIN_POINTS = 8
/**
 * Assumption: trend slope within 10% of the aimline slope counts as "on the
 * line" (keep collecting). The PRD does not give a tolerance.
 */
export const TREND_SLOPE_TOLERANCE = 0.1

// ---------- data needed (PRD 1B "Data needed") ----------

/** Fewer than 2 points ... */
export const DATA_NEEDED_MIN_POINTS = 2
/** ... in 2 weeks. */
export const DATA_NEEDED_WINDOW_DAYS = 14
/** Alert the case manager only after 2 failed attempts. */
export const DATA_NEEDED_MAX_ATTEMPTS = 2
/**
 * Assumption: a scheduled check or probe that brings no data within one school
 * week counts as a failed attempt. The PRD does not say how long to wait.
 */
export const DATA_NEEDED_ATTEMPT_DAYS = 7
/** Assumption: timed probes for rate objectives run for one minute (rate = correct items per minute). */
export const RATE_PROBE_SECONDS = 60

// ---------- what works (PRD 1B, 1A-9) ----------

/** Assumption: rows with fewer than 5 outcomes are hidden. The PRD says "a minimum count". */
export const WHAT_WORKS_MIN_N = 5

// ---------- proficiency suggestion (PRD 1B, BC Inclusive Education Reporting Guide) ----------

/** Assumption: the "data minimum" for a proficiency suggestion is the decision-rule minimum. */
export const PROFICIENCY_MIN_POINTS = DECISION_MIN_POINTS
export const PROFICIENCY_MIN_DAYS = DECISION_MIN_DAYS
/** Every suggestion states this (PRD: "states that a scale indicator is in relation to IEP goals"). */
export const PROFICIENCY_BASIS = 'in relation to IEP goals' as const

// ---------- weekly digest ----------

export const DIGEST_WINDOW_DAYS = 7

// ---------- student mode ----------

/** BC schools: "today" (EA scope, Today View) is the school's calendar day. */
export const SCHOOL_TIME_ZONE = 'America/Vancouver'

/** Assumption: student-mode sessions time out after 30 minutes (PRD: "time out automatically"). */
export const STUDENT_SESSION_MINUTES = 30
/** Assumption: break timer length when the IEP lists a break support. */
export const BREAK_TIMER_MINUTES = 5
