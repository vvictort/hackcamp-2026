import { describe, expect, it } from 'vitest'
import {
  aimline,
  canShowTrend,
  dataNeeded,
  decisionRule,
  goalStatus,
  independenceTrend,
  median,
  suggestProficiency,
  whatWorks,
  type Aimline,
  type Point,
} from './analytics'
import { WHAT_WORKS_MIN_N } from './thresholds'

const DAY = 24 * 60 * 60 * 1000
const START = Date.parse('2026-09-01T18:00:00.000Z')
const at = (day: number) => new Date(START + day * DAY).toISOString()

/** n points spread evenly across `days` days. */
function series(values: number[], days: number, source: Point['source'] = 'photo'): Point[] {
  const step = values.length > 1 ? days / (values.length - 1) : 0
  return values.map((value, i) => ({ at: at(i * step), value, source }))
}

const objective = { baseline: 40, target: 80, reviewDate: '2027-06-15' }
const line: Aimline = { start: { date: '2026-09-01', value: 40 }, end: { date: '2026-12-01', value: 80 } }

describe('decisionRule (PRD 1B)', () => {
  it('never fires below 6 points, however far apart', () => {
    for (let n = 0; n < 6; n++) {
      expect(decisionRule(series(Array(n).fill(0), 60), line)).toBe('silent')
      expect(decisionRule(series(Array(n).fill(100), 60), line)).toBe('silent')
    }
  })

  it('never fires across less than 3 weeks, however many points', () => {
    expect(decisionRule(series(Array(12).fill(0), 20), line)).toBe('silent')
    expect(decisionRule(series(Array(12).fill(100), 20.9), line)).toBe('silent')
  })

  it('6 to 7 points: last 4 below = change approach, above = raise goal, mixed = keep collecting', () => {
    expect(decisionRule(series([40, 40, 40, 40, 40, 40], 21), line)).toBe('change_approach')
    expect(decisionRule(series([90, 90, 90, 90, 90, 90, 90], 21), line)).toBe('raise_goal')
    expect(decisionRule(series([40, 40, 90, 10, 90, 10], 21), line)).toBe('keep_collecting')
  })

  it('8 or more points: compares the trend line with the aimline', () => {
    // Aimline gains about 3.1 per week; a flat series is flatter, a steep one steeper.
    expect(decisionRule(series(Array(8).fill(50), 28), line)).toBe('change_approach')
    expect(decisionRule(series([40, 50, 60, 70, 80, 90, 100, 110], 28), line)).toBe('raise_goal')
    const onLine = Array.from({ length: 8 }, (_, i) => 40 + (40 / 91) * 4 * i)
    expect(decisionRule(series(onLine, 28), line)).toBe('keep_collecting')
  })

  it('follows the goal direction for goals that reduce a behaviour', () => {
    const down: Aimline = { start: { date: '2026-09-01', value: 10 }, end: { date: '2026-12-01', value: 2 } }
    expect(decisionRule(series([12, 12, 12, 12, 12, 12], 21), down)).toBe('change_approach')
    expect(decisionRule(series([1, 1, 1, 1, 1, 1], 21), down)).toBe('raise_goal')
  })

  it('ignores teacher judgment when counting points', () => {
    expect(decisionRule(series(Array(10).fill(0), 40, 'teacher'), line)).toBe('silent')
  })
})

describe('goalStatus and aimline', () => {
  it('baseline is the median of the first 3, current the median of the last 3', () => {
    const s = goalStatus(series([40, 60, 50, 70, 75, 80], 30), objective, at(30))
    expect(s.baseline).toBe(50)
    expect(s.current).toBe(75)
    expect(s.target).toBe(80)
    expect(s.canShowTrend).toBe(true)
    expect(s.trend).toBeGreaterThan(0)
  })

  it('shows no trend below the data minimum', () => {
    const s = goalStatus(series([40, 60], 30), objective, at(30))
    expect(s.trend).toBeNull()
    expect(s.projectedDate).toBeNull()
    expect(s.baseline).toBe(40)
  })

  it('counts recent data in the last 2 weeks', () => {
    expect(goalStatus(series([1, 2, 3, 4], 30), objective, at(30)).recentCount).toBe(2)
  })

  it('aimline runs from the median baseline to the target at the review date', () => {
    const l = aimline(series([40, 60, 50], 10), objective)
    expect(l).toEqual({ start: { date: '2026-09-01', value: 50 }, end: { date: '2027-06-15', value: 80 } })
    expect(aimline([], { ...objective, reviewDate: null })).toBeNull()
  })

  it('median handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('canShowTrend (PRD 1B: no trend from judgment-only data)', () => {
  it('is false when the only evidence is teacher judgment', () => {
    expect(canShowTrend(series([1, 2, 3, 4, 5, 6], 30, 'teacher'))).toBe(false)
    expect(canShowTrend([])).toBe(false)
    expect(goalStatus(series([1, 2, 3, 4, 5, 6], 30, 'teacher'), objective, at(30)).canShowTrend).toBe(false)
  })

  it('is true once any quantitative evidence exists', () => {
    expect(canShowTrend([...series([1], 0, 'teacher'), ...series([2], 0, 'ea')])).toBe(true)
  })
})

describe('suggestProficiency (PRD 1B, BC reporting guide)', () => {
  it('suggests IE whenever the data minimum is unmet', () => {
    expect(suggestProficiency([], objective).level).toBe('IE')
    expect(suggestProficiency(series([90, 90, 90, 90, 90], 60), objective).level).toBe('IE')
    expect(suggestProficiency(series(Array(10).fill(90), 10), objective).level).toBe('IE')
    expect(suggestProficiency(series(Array(10).fill(90), 60, 'teacher'), objective).level).toBe('IE')
  })

  it('never defaults to Emerging or Developing: every thin-evidence case is IE', () => {
    const thin: Point[][] = [[], series([0], 0), series([0, 0, 0], 30), series(Array(5).fill(10), 40), series(Array(20).fill(10), 7)]
    for (const points of thin) {
      const s = suggestProficiency(points, { baseline: null, target: 80, reviewDate: null })
      expect(['Emerging', 'Developing']).not.toContain(s.level)
      expect(s.level).toBe('IE')
    }
  })

  it('always states it is in relation to IEP goals', () => {
    expect(suggestProficiency([], objective).basis).toBe('in relation to IEP goals')
    expect(suggestProficiency(series(Array(6).fill(85), 30), objective).basis).toBe('in relation to IEP goals')
  })

  it('suggests a scale level from sufficient evidence', () => {
    expect(suggestProficiency(series([40, 40, 40, 85, 85, 85], 30), objective).level).toBe('Proficient')
    expect(suggestProficiency(series([40, 40, 40, 60, 60, 60], 30), objective).level).toBe('Developing')
    expect(suggestProficiency(series([40, 40, 40, 30, 30, 30], 30), objective).level).toBe('Emerging')
  })
})

describe('dataNeeded (PRD 1B)', () => {
  const now = at(30)
  it('is ok with 2 points in the last 2 weeks', () => {
    expect(dataNeeded(series([1, 1], 5).map((p, i) => ({ ...p, at: at(25 + i) })), now, 0)).toBe('ok')
  })
  it('schedules a check quietly, and alerts only after 2 failed attempts', () => {
    const one = [{ at: at(29), value: 1 }]
    expect(dataNeeded(one, now, 0)).toBe('schedule_check')
    expect(dataNeeded(one, now, 1)).toBe('schedule_check')
    expect(dataNeeded(one, now, 2)).toBe('alert')
    expect(dataNeeded(series([1, 1, 1], 5), now, 0)).toBe('schedule_check')
  })
})

describe('whatWorks and independenceTrend', () => {
  it('hides rows below the minimum count, with sample sizes', () => {
    const outcomes = [
      ...Array.from({ length: WHAT_WORKS_MIN_N }, () => ({ adaptationType: 'visual_supports' as const, outcome: 0.5 })),
      { adaptationType: 'chunked_steps' as const, outcome: 1 },
    ]
    const rows = whatWorks(outcomes)
    expect(rows).toEqual([
      { adaptationType: 'visual_supports', n: WHAT_WORKS_MIN_N, meanOutcome: 0.5, hidden: false },
      { adaptationType: 'chunked_steps', n: 1, meanOutcome: null, hidden: true },
    ])
  })

  it('reports the share of attempts at each prompt level per week', () => {
    const weeks = independenceTrend([
      { at: '2026-09-14T10:00:00.000Z', value: 5 },
      { at: '2026-09-15T10:00:00.000Z', value: 3 },
      { at: '2026-09-22T10:00:00.000Z', value: 5 },
    ])
    expect(weeks).toHaveLength(2)
    expect(weeks[0].weekStart).toBe('2026-09-14')
    expect(weeks[0].shares.independent).toBe(0.5)
    expect(weeks[0].shares.gesture).toBe(0.5)
    expect(weeks[1].shares.independent).toBe(1)
  })
})
