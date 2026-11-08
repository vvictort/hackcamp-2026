import { Card, Progress } from '@/components/ui'
import { getWhatWorks } from '@/lib/altamira/students-api'
import { s } from './text'
import { useLoad } from './useLoad'

/** Strategies ranked by mean outcome with evidence counts; rows under the minimum count are not shown by the server. */
export function WhatWorks({ studentId }: { studentId: string }) {
  const ww = useLoad(() => getWhatWorks(studentId), studentId)
  return (
    <Card title={s('students.whatWorks')}>
      {ww.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
      {ww.status === 'error' && <p role="alert" className="text-small">{ww.error.message}</p>}
      {ww.status === 'ready' &&
        (() => {
          const visible = ww.data.rows.filter((r) => !r.hidden && r.meanOutcome !== null).sort((a, b) => (b.meanOutcome ?? 0) - (a.meanOutcome ?? 0))
          const hiddenCount = ww.data.rows.filter((r) => r.hidden).length
          return (
            <>
              {visible.length === 0 ? (
                <p className="text-body text-muted-foreground">{s('students.whatWorks.empty')}</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {visible.map((r, i) => {
                    const pct = Math.max(0, Math.min(100, Math.round((r.meanOutcome ?? 0) * 100)))
                    const name = s(`students.adaptation.${r.adaptationType}` as const)
                    return (
                      <li key={r.adaptationType} className="flex flex-col gap-1">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-semibold">{i + 1}. {name}</span>
                          <span className="text-small text-muted-foreground">{s('students.whatWorks.evidence', { n: r.n, pct })}</span>
                        </div>
                        <Progress value={pct} label={name} />
                      </li>
                    )
                  })}
                </ol>
              )}
              {hiddenCount > 0 && <p className="text-small text-muted-foreground">{s('students.whatWorks.hidden', { n: hiddenCount })}</p>}
            </>
          )
        })()}
    </Card>
  )
}
