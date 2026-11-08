import { useState } from 'react'
import { ClipboardCheck, FileText } from 'lucide-react'
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState } from '@/components/ui'
import { useLang } from '@/i18n'
import { getDataPointSource } from '@/lib/altamyra/students-api'
import type { DataPoint, Decision, Goal, Objective } from '@/server/altamyra/contract/student'
import { DecisionBadge, PointStatusBadge } from './badges'
import { fmtDate, s } from './text'
import { useLoad } from './useLoad'
import { getLensUsage } from './WhatWorks'

interface Props {
  studentId: string
  dataPoints: DataPoint[]
  decisions: Decision[]
  goals: Goal[]
  objectives: Objective[]
}

/** Timeline of data points (newest first) with decision-rule events and a View source link per point. */
export function Timeline({ studentId, dataPoints, decisions, goals, objectives }: Props) {
  const [sourceFor, setSourceFor] = useState<DataPoint | null>(null)
  const { t } = useLang()
  const usage = useLoad(() => getLensUsage(studentId), studentId)
  const lensEvents = usage.status === 'ready' ? usage.data.events : []
  const goalOf = (objectiveId: string) => {
    const gid = objectives.find((o) => o.id === objectiveId)?.goalId
    return goals.find((g) => g.id === gid)?.area ?? ''
  }
  const rows = [...dataPoints].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
  return (
    <Card title={s('students.timeline')}>
      {rows.length === 0 ? (
        <EmptyState className="py-8" icon={<FileText aria-hidden />} title={s('students.timeline.empty')} description={s('students.timeline.emptyHelp')} />
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="flex flex-col gap-1">
                <span className="text-body font-semibold">
                  {p.value} {p.unit}
                </span>
                <span className="text-small text-muted-foreground">
                  {fmtDate(p.recordedAt)} · {goalOf(p.objectiveId)} · {s(`students.source.${p.source}` as const)}
                </span>
                {p.reason && <span className="text-small text-muted-foreground">{p.reason}</span>}
              </div>
              <div className="flex items-center gap-2">
                <PointStatusBadge status={p.status} />
                <Button size="sm" variant="outline" onClick={() => setSourceFor(p)}>
                  {s('students.timeline.viewSource')}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {lensEvents.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t('app.lensUsage.usedTitle')}>
          {lensEvents.map((e, i) => (
            <li key={`${e.suggestionId}-${e.at}-${i}`} className="flex flex-wrap items-center gap-2 text-small">
              <ClipboardCheck className="size-4 shrink-0" aria-hidden />
              <span className="font-semibold">{t('app.lensUsage.timelineItem', { title: e.title })}</span>
              <span className="text-muted-foreground">{fmtDate(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {decisions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-semibold">{s('students.timeline.decisions')}</h3>
          <ul className="flex flex-col gap-2">
            {decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-small">
                <DecisionBadge rule={d.rule} />
                <span className="text-muted-foreground">{fmtDate(d.firedAt)} · {goalOf(d.objectiveId)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog open={sourceFor !== null} onOpenChange={(v) => !v && setSourceFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s('students.source.title')}</DialogTitle>
            <DialogDescription>{sourceFor ? `${sourceFor.value} ${sourceFor.unit} · ${fmtDate(sourceFor.recordedAt)}` : ''}</DialogDescription>
          </DialogHeader>
          {sourceFor && <SourceBody studentId={studentId} point={sourceFor} />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function SourceBody({ studentId, point }: { studentId: string; point: DataPoint }) {
  const src = useLoad(() => getDataPointSource(point.id, studentId), point.id)
  if (src.status === 'loading') return <p role="status">{s('students.loading')}</p>
  if (src.status === 'error') return <p role="alert">{src.error.message}</p>
  const x = src.data.source
  switch (x.kind) {
    case 'photo':
      return (
        <div className="flex flex-col gap-2">
          <img
            src={`/api/v1/files/${encodeURIComponent(x.fileKey)}`}
            alt={s('students.source.photoAlt')}
            className="max-h-72 rounded-md border border-border object-contain"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          <p className="text-small text-muted-foreground">{s('students.source.photoDetail', { key: x.fileKey, item: x.itemId ?? '-' })}</p>
        </div>
      )
    case 'ea_event':
      return <p>{s('students.source.eaEvent', { kind: x.eventKind.replace('_', ' ') })}</p>
    case 'usage':
      return <p>{s('students.source.usage')}</p>
    case 'teacher':
      return <p>{x.note ?? s('students.source.teacherNoNote')}</p>
  }
}
