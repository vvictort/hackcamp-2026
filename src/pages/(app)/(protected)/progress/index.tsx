import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, Sparkles, TrendingUp } from 'lucide-react'
import { Card, EmptyState, PageHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusBadge } from '@/components/ui'
import { fmtDate, s, type SKey } from '@/components/students/text'
import { useLoad } from '@/components/students/useLoad'
import { RoleGate } from '@/lib/altamira/RoleGate'
import {
  dayTotal, getDay, getDays, getWeeklySummary, lastNDays, sortDays, trendBars, visibleSummary, type DayDetail,
} from '@/lib/altamira/progress-api'
import { getMe } from '@/lib/altamira/students-api'

const KINDS = ['dataPoints', 'events', 'notes', 'videos', 'voiceNotes'] as const

function line(kind: (typeof KINDS)[number], d: DayDetail, i: number): string {
  if (kind === 'dataPoints') {
    const x = d.dataPoints[i]
    return [x.value !== undefined ? `${x.value}${x.unit ? ` ${x.unit}` : ''}` : '', x.status, x.reason].filter(Boolean).join(' - ')
  }
  if (kind === 'events') {
    const x = d.events[i]
    return [x.label ?? x.kind, x.text].filter(Boolean).join(' - ')
  }
  if (kind === 'notes') return d.notes[i].text
  if (kind === 'videos') return d.videos[i].name ?? d.videos[i].url ?? ''
  return d.voiceNotes[i].transcript ?? ''
}

function DayBody({ studentId, date }: { studentId: string; date: string }) {
  const day = useLoad(() => getDay(studentId, date), `${studentId}:${date}`)
  if (day.status === 'loading') return <p role="status" className="text-small text-muted-foreground">{s('progress.day.loading')}</p>
  if (day.status === 'error') return <p role="alert" className="text-small">{day.error.message}</p>
  const d = day.data
  const total = KINDS.reduce((n, k) => n + d[k].length, 0)
  return (
    <div className="flex flex-col gap-4 pt-3">
      {d.dailySummary && (
        <div className="flex flex-col gap-1">
          <h4 className="text-label font-semibold">{s('progress.day.summary')}</h4>
          <p className="whitespace-pre-wrap text-body">{d.dailySummary.text}</p>
        </div>
      )}
      {total === 0 && <p className="text-small text-muted-foreground">{s('progress.day.nothing')}</p>}
      {KINDS.map((k) =>
        d[k].length === 0 ? null : (
          <div key={k} className="flex flex-col gap-1">
            <h4 className="text-label font-semibold">{s(`progress.day.${k}` as SKey)}</h4>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
              {d[k].map((_, i) => <li key={i}>{line(k, d, i)}</li>)}
            </ul>
          </div>
        ),
      )}
      <p>
        {d.review?.reviewed ? (
          <StatusBadge tone="success">{s('progress.day.reviewed')}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{s('progress.day.notReviewed')}</StatusBadge>
        )}
      </p>
    </div>
  )
}

function ProgressBody() {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<string | null>(null)
  const me = useLoad(getMe, 'me')
  const list = me.status === 'ready' ? [...new Map([...me.data.caseload, ...me.data.students].map((x) => [x.id, x])).values()] : []
  const id = params.get('student') && list.some((x) => x.id === params.get('student')) ? params.get('student')! : (list[0]?.id ?? '')
  const current = list.find((x) => x.id === id)
  const canSeeDraft = !!current?.roles.some((r) => r === 'ea' || r === 'teacher')

  const range = lastNDays(14)
  const days = useLoad(() => getDays(id, range.from, range.to), id ? id : null)
  const summary = useLoad(() => getWeeklySummary(id), id ? id : null)
  const sum = summary.status === 'ready' ? visibleSummary(summary.data.summary, canSeeDraft) : null
  const rows = days.status === 'ready' ? sortDays(days.data.days) : []
  const bars = days.status === 'ready' ? trendBars(days.data.days) : []

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      <PageHeader title={s('progress.title')} description={s('progress.description')} />
      {me.status === 'loading' && <p role="status" className="text-muted-foreground">{s('students.loading')}</p>}
      {me.status === 'error' && <p role="alert">{me.error.message}</p>}
      {me.status === 'ready' && list.length === 0 && (
        <Card><EmptyState icon={<TrendingUp aria-hidden />} title={s('progress.noStudents')} /></Card>
      )}
      {list.length > 0 && (
        <>
          <div className="flex max-w-xs flex-col gap-2">
            <label className="text-label font-semibold" id="progress-student">{s('progress.student')}</label>
            <Select value={id} onValueChange={(v) => { setOpen(null); setParams({ student: v }, { replace: true }) }}>
              <SelectTrigger aria-labelledby="progress-student"><SelectValue /></SelectTrigger>
              <SelectContent>
                {list.map((x) => <SelectItem key={x.id} value={x.id}>{x.firstName ?? x.displayToken}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Card title={s('progress.summary.weekly')}>
            {summary.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
            {summary.status === 'error' && <p role="alert" className="text-small">{summary.error.message}</p>}
            {summary.status === 'ready' && !sum && <p className="text-body text-muted-foreground">{s('progress.summary.none')}</p>}
            {sum && (
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-2">
                  {sum.status === 'draft' ? (
                    <StatusBadge tone="warning">{s('progress.summary.draft')}</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">{s('progress.summary.approved')}</StatusBadge>
                  )}
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden />
                  {sum.status === 'draft' && <span className="text-small text-muted-foreground">{s('progress.summary.draftHelp')}</span>}
                </p>
                <p className="whitespace-pre-wrap text-body">{sum.text}</p>
              </div>
            )}
          </Card>

          <Card title={s('progress.trend')}>
            {days.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
            {days.status === 'error' && (
              <p role="alert" className="text-small">
                {days.error.message}{' '}
                <button type="button" className="font-semibold underline" onClick={days.reload}>{s('students.retry')}</button>
              </p>
            )}
            {days.status === 'ready' && rows.length === 0 && <p className="text-body text-muted-foreground">{s('progress.days.empty')}</p>}
            {bars.length > 0 && (
              <div role="img" aria-label={s('progress.trend.label')} className="flex h-28 items-end gap-1">
                {bars.map((b) => (
                  <div key={b.date} title={`${fmtDate(b.date)}: ${b.total}`} className="flex-1 rounded-t bg-primary" style={{ height: `${Math.max(4, Math.round(b.h * 100))}%` }} />
                ))}
              </div>
            )}
          </Card>

          {rows.length > 0 && (
            <section aria-labelledby="days-h" className="flex flex-col gap-3">
              <h2 id="days-h" className="text-h2 font-extrabold">{s('progress.days')}</h2>
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
                          {s('progress.day.items', { n: dayTotal(r.counts) })}
                          <span className="flex items-center gap-1">
                            {r.reviewed ? <CircleCheck className="size-4" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
                            {s(r.reviewed ? 'progress.day.reviewed' : 'progress.day.notReviewed')}
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
