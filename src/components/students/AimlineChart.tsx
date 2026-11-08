import { useId } from 'react'
import { CHART, buildChart, type ChartInput } from './chartGeometry'
import { s } from './text'

/** Plain SVG chart: data points (circles, solid line) against the aimline (dashed). A table repeats the numbers. */
export function AimlineChart({ data, unit }: { data: ChartInput; unit: string }) {
  const id = useId()
  const m = buildChart(data)
  if (m.empty) return <p className="text-small text-muted-foreground">{s('students.chart.empty')}</p>
  const last = m.dots[m.dots.length - 1]
  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} role="img" aria-labelledby={`${id}-t ${id}-d`} className="h-auto w-full max-w-2xl text-foreground">
        <title id={`${id}-t`}>{s('students.chart.title')}</title>
        <desc id={`${id}-d`}>{s('students.chart.desc', { n: m.dots.length, last: last ? `${last.value} ${unit}` : '-', aim: data.end ? `${data.end.value} ${unit}` : '-' })}</desc>
        {m.yTicks.map((t) => (
          <g key={t.y}>
            <line x1={CHART.l} x2={CHART.w - CHART.r} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.15} />
            <text x={CHART.l - 6} y={t.y + 4} textAnchor="end" fontSize={12} fill="currentColor">{t.label}</text>
          </g>
        ))}
        {m.xTicks.map((t) => (
          <text key={t.x} x={t.x} y={CHART.h - 12} textAnchor="middle" fontSize={12} fill="currentColor">{t.label}</text>
        ))}
        {m.aim && <line {...m.aim} stroke="currentColor" strokeWidth={2} strokeDasharray="8 5" />}
        {m.dots.length > 1 && <polyline fill="none" stroke="currentColor" strokeWidth={2} points={m.dots.map((d) => `${d.x},${d.y}`).join(' ')} />}
        {m.dots.map((d) => (
          <circle key={d.id} cx={d.x} cy={d.y} r={5} fill="var(--color-card, #fff)" stroke="currentColor" strokeWidth={2.5} />
        ))}
      </svg>
      <p className="flex flex-wrap gap-4 text-small text-muted-foreground">
        <span>{s('students.chart.legendData')}</span>
        <span>{s('students.chart.legendAim')}</span>
      </p>
      <details className="text-small">
        <summary className="cursor-pointer font-semibold">{s('students.chart.table')}</summary>
        <table className="mt-2 w-full max-w-md text-start">
          <thead>
            <tr>
              <th scope="col" className="py-1 text-start">{s('students.chart.date')}</th>
              <th scope="col" className="py-1 text-start">{s('students.chart.value')}</th>
            </tr>
          </thead>
          <tbody>
            {data.points.map((p) => (
              <tr key={p.id}>
                <td className="py-1">{p.date.slice(0, 10)}</td>
                <td className="py-1">{p.value} {unit}</td>
              </tr>
            ))}
            {data.start && <tr><td className="py-1">{data.start.date} ({s('students.chart.aimStart')})</td><td className="py-1">{data.start.value} {unit}</td></tr>}
            {data.end && <tr><td className="py-1">{data.end.date} ({s('students.chart.aimEnd')})</td><td className="py-1">{data.end.value} {unit}</td></tr>}
          </tbody>
        </table>
      </details>
    </div>
  )
}
