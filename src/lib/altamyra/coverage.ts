/** Goal data coverage for the Home Pulse card. */

export type Coverage = 'fresh' | 'stale' | 'data_needed'
export type CoverageCounts = Record<Coverage, number>

/** The slice of GET /students/:id/goals/:gid/status the Pulse needs. */
export type GoalStatusLite = {
  objectiveId: string | null
  current: number | null
  recentCount: number
  latestDecision: 'below_aimline' | 'above_aimline' | 'data_needed' | null
}

/** Data needed: no confirmed objective, no data, or the data-needed rule fired. Stale: under 2 recent points. */
export function coverageOf(s: GoalStatusLite): Coverage {
  if (!s.objectiveId || s.current === null || s.recentCount === 0 || s.latestDecision === 'data_needed') return 'data_needed'
  return s.recentCount < 2 ? 'stale' : 'fresh'
}

export function tallyCoverage(items: Coverage[]): CoverageCounts {
  const out: CoverageCounts = { fresh: 0, stale: 0, data_needed: 0 }
  for (const i of items) out[i]++
  return out
}
