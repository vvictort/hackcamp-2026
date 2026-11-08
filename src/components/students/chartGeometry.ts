export interface ChartPoint {
  id: string
  date: string
  value: number
}
export interface ChartInput {
  start: { date: string; value: number } | null
  end: { date: string; value: number } | null
  points: ChartPoint[]
}
export const CHART = { w: 640, h: 260, l: 48, r: 16, t: 16, b: 36 } as const

export interface ChartModel {
  empty: boolean
  dots: { id: string; x: number; y: number; date: string; value: number }[]
  aim: { x1: number; y1: number; x2: number; y2: number } | null
  yTicks: { y: number; label: string }[]
  xTicks: { x: number; label: string }[]
}

const ms = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00Z` : d).getTime()

/** Maps dates and values to SVG coordinates. Pure so it can be tested without a DOM. */
export function buildChart(input: ChartInput): ChartModel {
  const times = [...input.points.map((p) => ms(p.date)), ...(input.start ? [ms(input.start.date)] : []), ...(input.end ? [ms(input.end.date)] : [])]
  const vals = [...input.points.map((p) => p.value), ...(input.start ? [input.start.value] : []), ...(input.end ? [input.end.value] : [])]
  if (times.length === 0) return { empty: true, dots: [], aim: null, yTicks: [], xTicks: [] }
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const vMin = Math.min(0, ...vals)
  const vMax = Math.max(...vals, vMin + 1)
  const iw = CHART.w - CHART.l - CHART.r
  const ih = CHART.h - CHART.t - CHART.b
  const X = (t: number) => CHART.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw)
  const Y = (v: number) => CHART.t + ih - ((v - vMin) / (vMax - vMin)) * ih
  const round = (n: number) => Math.round(n * 10) / 10
  return {
    empty: false,
    dots: input.points.map((p) => ({ id: p.id, x: round(X(ms(p.date))), y: round(Y(p.value)), date: p.date.slice(0, 10), value: p.value })),
    aim:
      input.start && input.end
        ? { x1: round(X(ms(input.start.date))), y1: round(Y(input.start.value)), x2: round(X(ms(input.end.date))), y2: round(Y(input.end.value)) }
        : null,
    yTicks: [vMin, (vMin + vMax) / 2, vMax].map((v) => ({ y: round(Y(v)), label: String(Math.round(v * 10) / 10) })),
    xTicks: [...new Set([t0, t1])].map((t) => ({ x: round(X(t)), label: new Date(t).toISOString().slice(0, 10) })),
  }
}
