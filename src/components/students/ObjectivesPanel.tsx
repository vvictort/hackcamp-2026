import { useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormField, Textarea, useToast } from '@/components/ui'
import { confirmObjective, flagObjective } from '@/lib/altamyra/students-api'
import type { Objective } from '@/server/altamyra/contract/student'
import { ObjectiveBadge } from './badges'
import { fmtDate, s } from './text'

interface Props {
  studentId: string
  objectives: Objective[]
  canConfirm: boolean
  onChanged: () => void
}

/** Measurable objectives for one goal: case manager confirms, or flags one as unmeasurable with a reason. */
export function ObjectivesPanel({ studentId, objectives, canConfirm, onChanged }: Props) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [flagging, setFlagging] = useState<Objective | null>(null)
  const [reason, setReason] = useState('')

  const run = async (o: Objective, fn: () => Promise<unknown>, ok: string) => {
    setBusy(o.id)
    try {
      await fn()
      toast.success(ok)
      setFlagging(null)
      setReason('')
      onChanged()
    } catch (e) {
      toast.error(s('students.error.action'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  if (objectives.length === 0) return <p className="text-small text-muted-foreground">{s('students.objective.none')}</p>
  return (
    <>
      <ul className="flex flex-col gap-3">
        {objectives.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ObjectiveBadge status={o.status} />
              <span className="text-small text-muted-foreground">{s(`students.metric.${o.metricType}` as const)}</span>
            </div>
            <p className="text-body">
              {s('students.objective.line', { baseline: o.baseline ?? s('students.objective.noBaseline'), target: o.target, unit: o.unit })}
            </p>
            <p className="text-small text-muted-foreground">{o.masteryRule}</p>
            {o.reviewDate && <p className="text-small text-muted-foreground">{s('students.objective.review', { date: fmtDate(o.reviewDate) })}</p>}
            {o.flagReason && <p className="text-small">{s('students.objective.reason', { reason: o.flagReason })}</p>}
            {canConfirm && o.status !== 'confirmed' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === o.id} onClick={() => run(o, () => confirmObjective(o.id, studentId, { expectedVersion: o.version }), s('students.objective.confirmedToast'))}>
                  {s('students.objective.confirm')}
                </Button>
                {o.status === 'proposed' && (
                  <Button size="sm" variant="outline" onClick={() => setFlagging(o)}>
                    {s('students.objective.flag')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={flagging !== null} onOpenChange={(v) => !v && setFlagging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s('students.objective.flagTitle')}</DialogTitle>
            <DialogDescription>{s('students.objective.flagHelp')}</DialogDescription>
          </DialogHeader>
          <FormField label={s('students.objective.flagReason')} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </FormField>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFlagging(null)}>{s('students.cancel')}</Button>
            <Button
              disabled={!reason.trim()}
              loading={flagging !== null && busy === flagging.id}
              onClick={() => flagging && run(flagging, () => flagObjective(flagging.id, studentId, flagging.version, reason.trim()), s('students.objective.flaggedToast'))}
            >
              {s('students.objective.flagSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
