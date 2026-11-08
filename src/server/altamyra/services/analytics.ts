import type { AdaptationType } from '../contract/enums'
import type { Point } from '../contract/student'
import {
  BASELINE_POINTS,
  CURRENT_POINTS,
  DATA_NEEDED_MAX_ATTEMPTS,
  DATA_NEEDED_MIN_POINTS,
  DATA_NEEDED_WINDOW_DAYS,
  DECISION_MIN_DAYS,
  DECISION_MIN_POINTS,
  DECISION_RECENT_POINTS,
  DECISION_TREND_MIN_POINTS,
  RECENT_WINDOW_DAYS,
  TREND_SLOPE_TOLERANCE,
  WHAT_WORKS_MIN_N,
  DAY_MS,
  daysToMs,
} from './thresholds'

/**
 * Pure analytics over one goal's confirmed data points (design doc
 * "Analytics, decision rules and jobs"). Callers pass only confirmed and
 * auto-confirmed, non-superseded points.
 */

export type ObjectiveTarget = { baseline: number | null; target: number; reviewDate: string | null }

const WEEK_MS = daysToMs(7)

const time = (iso: string) => Date.parse(iso)
const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const sorted = (points: readonly Point[]) => [...points].sort((a, b) => time(a.at) - time(b.at))

export const mondayOf = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Ordinary least squares slope of value over time, per millisecond. */
function slopePerMs(points: readonly Point[]): { slope: number; intercept: number } | null {
  if (points.length < 2) return null
  const xs = points.map((p) => time(p.at))
  const ys = points.map((p) => p.value)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den === 0) return null
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

/** Points that count as quantitative evidence. Teacher judgment is qualitative only (PRD 1B "Teacher judgment"). */
const quantitative = (points: readonly Point[]) => points.filter((p) => p.source !== 'teacher')

/** PRD 1B: "a goal can't show a trend from judgment-only data". */
export function canShowTrend(points: readonly Point[]): boolean {
  return quantitative(points).length > 0
}

/** PRD 1B: rules and trends apply only after at least 6 points across at least 3 weeks. */
export function meetsMinimum(points: readonly Point[]): boolean {
  if (points.length < DECISION_MIN_POINTS) return false
  const s = sorted(points)
  return time(s[s.length - 1].at) - time(s[0].at) >= daysToMs(DECISION_MIN_DAYS)
}

// ---------- goalStatus ----------

export type GoalStatus = {
  baseline: number | null
  current: number | null
  target: number
  /** Trend slope in units per week; null below the data minimum or for judgment-only goals. */
  trend: number | null
  projectedDate: string | null
  recentCount: number
  canShowTrend: boolean
}

/** Baseline = median of the first 3 points (falls back to the objective's baseline below 3). */
export function baselineOf(points: readonly Point[], objective: ObjectiveTarget): number | null {
  const q = sorted(quantitative(points))
  if (q.length >= BASELINE_POINTS) return median(q.slice(0, BASELINE_POINTS).map((p) => p.value))
  return objective.baseline ?? median(q.map((p) => p.value))
}

export function goalStatus(points: readonly Point[], objective: ObjectiveTarget, now: string): GoalStatus {
  const q = sorted(quantitative(points))
  const showTrend = canShowTrend(points)
  const current = q.length > 0 ? median(q.slice(-CURRENT_POINTS).map((p) => p.value)) : null
  const recentCount = q.filter((p) => time(p.at) >= time(now) - daysToMs(RECENT_WINDOW_DAYS)).length

  let trend: number | null = null
  let projectedDate: string | null = null
  const fit = showTrend && meetsMinimum(q) ? slopePerMs(q) : null
  if (fit) {
    trend = fit.slope * WEEK_MS
    const baseline = baselineOf(q, objective) ?? q[0].value
    const direction = Math.sign(objective.target - baseline) || 1
    if (fit.slope !== 0 && Math.sign(fit.slope) === direction) {
      const reachMs = (objective.target - fit.intercept) / fit.slope
      if (Number.isFinite(reachMs)) projectedDate = dateOnly(Math.max(reachMs, time(now)))
    }
  }
  return { baseline: baselineOf(q, objective), current, target: objective.target, trend, projectedDate, recentCount, canShowTrend: showTrend }
}

// ---------- aimline ----------

export type Aimline = { start: { date: string; value: number }; end: { date: string; value: number } }

/**
 * Goal line from the median baseline to the target at the IEP review date.
 * startFallback is used as the start date when there are no points yet.
 */
export function aimline(points: readonly Point[], objective: ObjectiveTarget, startFallback?: string): Aimline | null {
  if (!objective.reviewDate) return null
  const q = sorted(quantitative(points))
  const baseline = baselineOf(q, objective)
  const startAt = q[0]?.at ?? startFallback
  if (baseline === null || !startAt) return null
  return { start: { date: startAt.slice(0, 10), value: baseline }, end: { date: objective.reviewDate, value: objective.target } }
}

const lineTime = (date: string) => time(date.length === 10 ? `${date}T00:00:00.000Z` : date)

function aimSlopePerMs(line: Aimline): number {
  const span = lineTime(line.end.date) - lineTime(line.start.date)
  return span <= 0 ? 0 : (line.end.value - line.start.value) / span
}

export function aimlineValueAt(line: Aimline, at: string): number {
  return line.start.value + aimSlopePerMs(line) * (time(at) - lineTime(line.start.date))
}

// ---------- decisionRule ----------

export type DecisionOutcome = 'silent' | 'keep_collecting' | 'change_approach' | 'raise_goal'

/**
 * PRD 1B decision rules. Silent below 6 points or 3 weeks. With 6 to 7
 * points: the last 4 all on the wrong side of the aimline = change approach,
 * all on the right side = raise goal, mixed = keep collecting. With 8 or more:
 * trend slope vs aimline slope. "Right side" follows the goal's direction, so
 * a goal to reduce a behaviour works the same way.
 */
export function decisionRule(points: readonly Point[], line: Aimline | null): DecisionOutcome {
  const q = sorted(quantitative(points))
  // PRD 1B: no decision rule fires below 6 points or 3 weeks.
  if (!line || !meetsMinimum(q)) return 'silent'
  const direction = Math.sign(line.end.value - line.start.value) || 1

  if (q.length < DECISION_TREND_MIN_POINTS) {
    const sides = q.slice(-DECISION_RECENT_POINTS).map((p) => Math.sign(direction * (p.value - aimlineValueAt(line, p.at))))
    if (sides.every((s) => s < 0)) return 'change_approach'
    if (sides.every((s) => s > 0)) return 'raise_goal'
    return 'keep_collecting'
  }

  const fit = slopePerMs(q)
  if (!fit) return 'keep_collecting'
  const aim = aimSlopePerMs(line)
  const diff = direction * (fit.slope - aim)
  const tolerance = TREND_SLOPE_TOLERANCE * Math.abs(aim)
  if (diff < -tolerance) return 'change_approach'
  if (diff > tolerance) return 'raise_goal'
  return 'keep_collecting'
}

// ---------- dataNeeded ----------

export type DataNeeded = 'ok' | 'schedule_check' | 'alert'

/**
 * PRD 1B "Data needed": fewer than 2 points in 2 weeks schedules a check or
 * probe quietly; the case manager is alerted only after 2 failed attempts.
 */
export function dataNeeded(points: readonly Point[], now: string, failedAttempts: number): DataNeeded {
  const since = time(now) - daysToMs(DATA_NEEDED_WINDOW_DAYS)
  const recent = points.filter((p) => time(p.at) >= since && time(p.at) <= time(now)).length
  if (recent >= DATA_NEEDED_MIN_POINTS) return 'ok'
  return failedAttempts >= DATA_NEEDED_MAX_ATTEMPTS ? 'alert' : 'schedule_check'
}

// ---------- whatWorks ----------

export type Outcome = { adaptationType: AdaptationType; outcome: number }
export type WhatWorksRow = { adaptationType: AdaptationType; n: number; meanOutcome: number | null; hidden: boolean }

/**
 * Normalised progress of one value toward the target: 0 at baseline, 1 at
 * target, direction-aware. Null when baseline equals target.
 */
export function progressFraction(value: number, baseline: number, target: number): number | null {
  if (target === baseline) return null
  return (value - baseline) / (target - baseline)
}

/** PRD 1B "What works": outcomes by adaptation type within one student, with sample sizes, hidden below the minimum count. */
export function whatWorks(outcomes: readonly Outcome[]): WhatWorksRow[] {
  const byType = new Map<AdaptationType, number[]>()
  for (const o of outcomes) byType.set(o.adaptationType, [...(byType.get(o.adaptationType) ?? []), o.outcome])
  return [...byType.entries()]
    .map(([adaptationType, values]) => {
      const hidden = values.length < WHAT_WORKS_MIN_N
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      return { adaptationType, n: values.length, meanOutcome: hidden ? null : Math.round(mean * 100) / 100, hidden }
    })
    .sort((a, b) => b.n - a.n)
}
