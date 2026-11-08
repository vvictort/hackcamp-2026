import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck, ClipboardCheck } from 'lucide-react'
import { Button, buttonVariants, Card, EmptyState, FormField, Input, StatusBadge, useToast, type FormFieldControlProps } from '@/components/ui'
import type { z } from 'zod'
import type { ReviewQueueResponse } from '@/server/altamira/contract/api'
import { ApiError, cachedImage, confirmReview, correctDataPoint, fileKeyOfSourceRef, getReviewQueue } from '@/lib/altamira/capture-api'
import { useCt } from './useCt'
import { useStudents } from './useStudents'
import { studentLabel } from './StudentSelect'

type Entry = z.output<typeof ReviewQueueResponse>['items'][number]

export function ReviewList() {
  const ct = useCt()
  const toast = useToast()
  const { students } = useStudents()
  const [items, setItems] = useState<Entry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<{ studentId: string }[]>([])

  const load = useCallback(() => {
    setFailed(false)
    getReviewQueue()
      .then((r) => setItems(r.items))
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  const remove = (e: Entry, msg: string) => {
    setItems((cur) => (cur ?? []).filter((x) => x.item.id !== e.item.id))
    setDone((d) => [...d, { studentId: e.studentId }])
    toast.success(msg)
  }
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      toast.error(ct('capture.review.conflictToast'))
      load()
    } else toast.error(ct('capture.review.failedToast'))
  }

  if (failed)
    return (
      <Card>
        <p role="alert">{ct('capture.common.loadFailed')}</p>
        <div>
          <Button onClick={load}>{ct('capture.common.retry')}</Button>
        </div>
      </Card>
    )
  if (!items) return <p role="status">{ct('capture.common.loading')}</p>

  const timelineIds = [...new Set(done.map((d) => d.studentId))]
  return (
    <div className="flex flex-col gap-5">
      {timelineIds.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {timelineIds.map((id) => {
            const s = students.find((x) => x.id === id)
            return (
              <Link key={id} to={`/students/${id}`} className={buttonVariants({ variant: 'outline' })}>
                {ct('capture.common.profile', { student: s ? studentLabel(s, ct) : '' })}
              </Link>
            )
          })}
        </div>
      )}
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardCheck />} title={ct('capture.review.empty')} description={ct('capture.review.emptyBody')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((e) => (
            <ReviewRow key={e.item.id} entry={e} name={studentName(students, e.studentId, ct)} onDone={remove} onError={onError} />
          ))}
        </ul>
      )}
    </div>
  )
}

function studentName(students: ReturnType<typeof useStudents>['students'], id: string, ct: ReturnType<typeof useCt>) {
  const s = students.find((x) => x.id === id)
  return s ? studentLabel(s, ct) : ''
}

function ReviewRow({
  entry,
  name,
  onDone,
  onError,
}: {
  entry: Entry
  name: string
  onDone: (e: Entry, msg: string) => void
  onError: (err: unknown) => void
}) {
  const ct = useCt()
  const { dataPoint: dp, item, studentId } = entry
  const [mode, setMode] = useState<'view' | 'correct'>('view')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [errs, setErrs] = useState<{ value?: string; reason?: string }>({})
  const [busy, setBusy] = useState(false)
  const fileKey = fileKeyOfSourceRef(dp.sourceRef)
  const image = fileKey ? cachedImage(fileKey) : null

  async function confirm() {
    setBusy(true)
    try {
      await confirmReview(studentId, item.id, { expectedVersion: item.version })
      onDone(entry, ct('capture.review.confirmedToast'))
    } catch (err) {
      onError(err)
      setBusy(false)
    }
  }
  async function correct(ev: React.FormEvent) {
    ev.preventDefault()
    const n = Number(value)
    const next = { value: value.trim() !== '' && Number.isFinite(n) ? undefined : ct('capture.review.needValue'), reason: reason.trim() ? undefined : ct('capture.review.needReason') }
    setErrs(next)
    if (next.value || next.reason) return
    setBusy(true)
    try {
      await correctDataPoint(studentId, dp.id, { expectedVersion: dp.version, value: n, reason: reason.trim() })
      onDone(entry, ct('capture.review.correctedToast'))
    } catch (err) {
      onError(err)
      setBusy(false)
    }
  }

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          {name && <strong>{name}</strong>}
          <StatusBadge tone="warning">{item.kind === 'low_confidence' ? ct('capture.review.kindLow') : ct('capture.review.kindSampled')}</StatusBadge>
          {dp.aiConfidence !== null && (
            <span className="text-small text-muted-foreground">{ct('capture.review.confidence', { pct: Math.round(dp.aiConfidence * 100) })}</span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
          {image ? (
            <img src={image} alt={ct('capture.review.sourceImage')} className="max-h-60 w-auto rounded-md border border-border" />
          ) : (
            <p className="text-small text-muted-foreground">{fileKey ? ct('capture.review.noImage') : ''}</p>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-small text-muted-foreground">{ct('capture.review.proposed')}</span>
            <span className="text-h2 font-extrabold">
              {Math.round(dp.value * 100) / 100} <span className="text-body font-normal">{dp.unit}</span>
            </span>
            {fileKey && <span className="text-small text-muted-foreground break-all">{ct('capture.review.source', { key: fileKey })}</span>}
          </div>
        </div>
        {mode === 'view' ? (
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={confirm} loading={busy}>
              <CircleCheck aria-hidden />
              {ct('capture.review.confirm')}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setMode('correct')} disabled={busy}>
              {ct('capture.review.correct')}
            </Button>
          </div>
        ) : (
          <form onSubmit={correct} noValidate className="flex flex-col gap-4">
            <FormField label={ct('capture.review.correctedValue')} required error={errs.value}>
              {(c: FormFieldControlProps) => <Input {...c} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
            </FormField>
            <FormField label={ct('capture.review.reason')} required hint={ct('capture.review.reasonHint')} error={errs.reason}>
              {(c: FormFieldControlProps) => <Input {...c} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </FormField>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" loading={busy}>
                {ct('capture.review.save')}
              </Button>
              <Button type="button" size="lg" variant="ghost" onClick={() => setMode('view')} disabled={busy}>
                {ct('capture.review.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </li>
  )
}
