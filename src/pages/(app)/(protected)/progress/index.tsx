import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, Sparkles, TrendingUp } from 'lucide-react'
import { Card, EmptyState, PageHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusBadge } from '@/components/ui'
import { fmtDate } from '@/components/students/text'
import { LoadError, useLoad } from '@/lib/useLoad'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import {
  dayTotal, getDay, getDays, lastNDays, sortDays, trendBars, visibleSummary, type DayDetail,
} from '@/lib/altamyra/progress-api'
import { useAltamyraMe, visibleStudents } from '@/lib/altamyra/role'
import { listSummaries, pickCurrent } from '@/lib/altamyra/summaries-api'
import { studentLabel } from '@/components/capture/StudentSelect'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'

const KINDS = ['dataPoints', 'events', 'notes', 'videos', 'voiceNotes'] as const

type Point = DayDetail['dataPoints'][number]
const pointLine = (x: Point) => [`${x.value} ${x.unit}`.trim(), x.status, x.reason].filter(Boolean).join(' - ')

function line(kind: (typeof KINDS)[number], d: DayDetail, i: number): string {
  if (kind === 'notes') return d.notes[i].text
  if (kind === 'videos') return new Date(d.videos[i].recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return pointLine(d[kind][i])
}

function DayBody({ studentId, date }: { studentId: string; date: string }) {
  const { t } = useLang()
  const day = useLoad(() => getDay(studentId, date), `${studentId}:${date}`)
  if (day.status === 'loading') return <p role="status" className="text-small text-muted-foreground">{t('progress.day.loading')}</p>
  if (day.status === 'error') return <LoadError error={day.error} />
  const d = day.data
  const total = KINDS.reduce((n, k) => n + d[k].length, 0)
  return (
    <div className="flex flex-col gap-4 pt-3">
      {d.dailySummary && (
        <div className="flex flex-col gap-1">
          <h4 className="text-label font-semibold">{t('progress.day.summary')}</h4>
          <p className="whitespace-pre-wrap text-body">{d.dailySummary.text}</p>
        </div>
      )}
      {total === 0 && <p className="text-small text-muted-foreground">{t('progress.day.nothing')}</p>}
      {KINDS.map((k) =>
        d[k].length === 0 ? null : (
          <div key={k} className="flex flex-col gap-1">
            <h4 className="text-label font-semibold">{t(`progress.day.${k}` as MessageKey)}</h4>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
              {d[k].map((_, i) => <li key={i}>{line(k, d, i)}</li>)}
            </ul>
          </div>
        ),
      )}
      <p>
        {d.review ? (
          <StatusBadge tone="success">{t('progress.day.reviewed')}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{t('progress.day.notReviewed')}</StatusBadge>
        )}
      </p>
    </div>
  )
}

function ProgressBody() {
  const { t } = useLang()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<string | null>(null)
  const { me } = useAltamyraMe()
  const list = visibleStudents(me)
  const id = params.get('student') && list.some((x) => x.id === params.get('student')) ? params.get('student')! : (list[0]?.id ?? '')
  const current = list.find((x) => x.id === id)
  const canSeeDraft = !!current?.roles.some((r) => r === 'ea' || r === 'teacher')

  const range = lastNDays(14)
  const days = useLoad(() => getDays(id, range.from, range.to), id ? id : null)
  const summary = useLoad(() => listSummaries(id, 'weekly'), id ? id : null)
  const sum = summary.status === 'ready' ? visibleSummary(pickCurrent(summary.data), canSeeDraft) : null
  const rows = days.status === 'ready' ? sortDays(days.data.days) : []
  const bars = days.status === 'ready' ? trendBars(days.data.days) : []

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('progress.title')} description={t('progress.description')} />
      {list.length === 0 && (
        <Card><EmptyState icon={<TrendingUp aria-hidden />} title={t('progress.noStudents')} /></Card>
      )}
      {list.length > 0 && (
        <>
          <div className="flex max-w-xs flex-col gap-2">
            <label className="text-label font-semibold" id="progress-student">{t('progress.student')}</label>
            <Select value={id} onValueChange={(v) => { setOpen(null); setParams({ student: v }, { replace: true }) }}>
              <SelectTrigger aria-labelledby="progress-student"><SelectValue /></SelectTrigger>
              <SelectContent>
                {list.map((x) => <SelectItem key={x.id} value={x.id}>{studentLabel(x, t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card title={t('progress.summary.weekly')}>
            {summary.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{t('students.loading')}</p>}
            {summary.status === 'error' && <LoadError error={summary.error} />}
            {summary.status === 'ready' && !sum && <p className="text-body text-muted-foreground">{t('progress.summary.none')}</p>}
            {sum && (
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-2">
                  {sum.status === 'draft' ? (
                    <StatusBadge tone="warning">{t('progress.summary.draft')}</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">{t('progress.summary.approved')}</StatusBadge>
                  )}
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                  {sum.status === 'draft' && <span className="text-small text-muted-foreground">{t('progress.summary.draftHelp')}</span>}
                </p>
                <p className="whitespace-pre-wrap text-body">{sum.text}</p>
              </div>
            )}
          </Card>

          <Card title={t('progress.trend')}>
            {days.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{t('students.loading')}</p>}
            {days.status === 'error' && <LoadError error={days.error} onRetry={days.reload} />}
            {days.status === 'ready' && rows.length === 0 && <p className="text-body text-muted-foreground">{t('progress.days.empty')}</p>}
            {bars.length > 0 && (
              <div role="img" aria-label={t('progress.trend.label')} className="flex h-28 items-end gap-1">
                {bars.map((b) => (
                  <div key={b.date} title={`${fmtDate(b.date)}: ${b.total}`} className="flex-1 rounded-t bg-primary" style={{ height: `${Math.max(4, Math.round(b.h * 100))}%` }} />
                ))}
              </div>
            )}
          </Card>

          {rows.length > 0 && (
            <section aria-labelledby="days-h" className="flex flex-col gap-3">
              <h2 id="days-h" className="text-h2 font-extrabold">{t('progress.days')}</h2>
              <ul className="flex flex-col gap-3">
                {rows.map((r) => {
                  const isOpen = open === r.date
                  return (
                    <li key={r.date} className="rounded-lg border border-border bg-card p-3">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`day-${r.date}`}
                        onClick={() => setOpen(isOpen ? null : r.date)}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span className="flex items-center gap-2 text-body font-semibold">
                          {isOpen ? <ChevronDown className="size-5" aria-hidden /> : <ChevronRight className="size-5" aria-hidden />}
                          {fmtDate(r.date)}
                        </span>
                        <span className="flex flex-wrap items-center gap-3 text-small text-muted-foreground">
                          {t('progress.day.items', { n: dayTotal(r.counts) })}
                          <span className="flex items-center gap-1">
                            {r.reviewed ? <CircleCheck className="size-4" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
                            {t(r.reviewed ? 'progress.day.reviewed' : 'progress.day.notReviewed')}
                          </span>
                        </span>
                      </button>
                      {isOpen && <div id={`day-${r.date}`}><DayBody studentId={id} date={r.date} /></div>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default function ProgressPage() {
  return (
    <RoleGate path="/progress">
      <ProgressBody />
    </RoleGate>
  )
}
