import { describe, expect, it } from 'vitest'
import { buildChart } from './chartGeometry'

describe('buildChart', () => {
  it('is empty with no data', () => {
    expect(buildChart({ start: null, end: null, points: [] }).empty).toBe(true)
  })
  it('maps points left to right and higher values higher up', () => {
    const m = buildChart({
      start: { date: '2026-09-01', value: 0 },
      end: { date: '2026-12-01', value: 10 },
      points: [
        { id: 'a', date: '2026-09-01T10:00:00Z', value: 2 },
        { id: 'b', date: '2026-10-15T10:00:00Z', value: 8 },
      ],
    })
    expect(m.dots[1].x).toBeGreaterThan(m.dots[0].x)
    expect(m.dots[1].y).toBeLessThan(m.dots[0].y)
    expect(m.aim && m.aim.x2 > m.aim.x1 && m.aim.y2 < m.aim.y1).toBe(true)
    expect(m.xTicks).toHaveLength(2)
  })
  it('handles a single point', () => {
    const m = buildChart({ start: null, end: null, points: [{ id: 'a', date: '2026-09-01', value: 3 }] })
    expect(m.dots).toHaveLength(1)
    expect(m.aim).toBeNull()
    expect(m.xTicks).toHaveLength(1)
  })
})
