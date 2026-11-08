import { ClipboardCheck } from 'lucide-react'
import { Card, Progress } from '@/components/ui'
import { useLang } from '@/i18n'
import { apiFetch, getWhatWorks } from '@/lib/altamyra/students-api'
import type { AdaptationType } from '@/server/altamyra/contract/enums'
import { s } from './text'
import { useLoad } from './useLoad'

export type LensUsage = {
  events: { suggestionId: string; at: string; label: 'adaptation' | 'modification' | null; adaptationType: AdaptationType | null; title: string; text: string; goalIds: string[] }[]
  used: { adaptationType: AdaptationType; n: number }[]
}

/** GET /api/v1/students/:id/lens-usage: approved Lesson Lens adaptations for this student. */
export const getLensUsage = (studentId: string) => apiFetch<LensUsage>(`/students/${encodeURIComponent(studentId)}/lens-usage`)

/** Strategies ranked by mean outcome with evidence counts; rows under the minimum count are not shown by the server. */
export function WhatWorks({ studentId }: { studentId: string }) {
  const ww = useLoad(() => getWhatWorks(studentId), studentId)
  const usage = useLoad(() => getLensUsage(studentId), studentId)
  const { t } = useLang()
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
      {usage.status === 'ready' && usage.data.used.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-semibold">{t('app.lensUsage.usedTitle')}</h3>
          <ul className="flex flex-col gap-1">
            {usage.data.used.map((u) => (
              <li key={u.adaptationType} className="flex items-center gap-2 text-small">
                <ClipboardCheck className="size-4 shrink-0" aria-hidden />
                <span>
                  {t(u.n === 1 ? 'app.lensUsage.usedOnce' : 'app.lensUsage.usedCount', { type: s(`students.adaptation.${u.adaptationType}` as const), n: u.n })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
