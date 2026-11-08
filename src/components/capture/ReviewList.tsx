import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CircleCheck, ClipboardCheck } from 'lucide-react'
import { Button, buttonVariants, Card, EmptyState, FormField, Input, StatusBadge, useToast, type FormFieldControlProps } from '@/components/ui'
import type { z } from 'zod'
import type { ReviewQueueResponse } from '@/server/altamyra/contract/api'
import { ApiError } from '@/lib/altamyra/api'
import { cachedImage, confirmReview, correctDataPoint, fileKeyOfSourceRef, getReviewQueue } from '@/lib/altamyra/capture-api'
import { useAltamyraMe, visibleStudents, type StudentSummary } from '@/lib/altamyra/role'
import { SAMPLE_ITEM_ROWS, SAMPLE_SHEET_URL } from './stampSheetCode'
import { useLang } from '@/i18n'
import { studentLabel } from './StudentSelect'

type Entry = z.output<typeof ReviewQueueResponse>['items'][number]

export function ReviewList({ studentId, onChanged }: { studentId?: string; onChanged?: () => void } = {}) {
  const { t } = useLang()
  const toast = useToast()
  const students = visibleStudents(useAltamyraMe().me)
  const [items, setItems] = useState<Entry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<{ studentId: string }[]>([])

  const load = useCallback(() => {
    setFailed(false)
    getReviewQueue()
      .then((r) => setItems(studentId ? r.items.filter((x) => x.studentId === studentId) : r.items))
      .catch(() => setFailed(true))
  }, [studentId])
  useEffect(load, [load])

  const remove = (e: Entry, msg: string) => {
    setItems((cur) => (cur ?? []).filter((x) => x.item.id !== e.item.id))
    setDone((d) => [...d, { studentId: e.studentId }])
    toast.success(msg)
    onChanged?.()
  }
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      toast.error(t('capture.review.conflictToast'))
      load()
    } else toast.error(t('capture.review.failedToast'))
  }

  if (failed)
    return (
      <Card>
        <p role="alert">{t('capture.common.loadFailed')}</p>
        <div>
          <Button onClick={load}>{t('capture.common.retry')}</Button>
        </div>
      </Card>
    )
  if (!items) return <p role="status">{t('capture.common.loading')}</p>

  const timelineIds = [...new Set(done.map((d) => d.studentId))]
  return (
    <div className="flex flex-col gap-5">
      {timelineIds.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {timelineIds.map((id) => (
            <Link key={id} to={`/students/${id}`} className={buttonVariants({ variant: 'outline' })}>
              {t('capture.common.profile', { student: studentName(students, id, t) })}
            </Link>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardCheck />} title={t('capture.review.empty')} description={t('capture.review.emptyBody')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((e) => (
            <ReviewRow key={e.item.id} entry={e} name={studentName(students, e.studentId, t)} onDone={remove} onError={onError} />
          ))}
        </ul>
      )}
    </div>
  )
}

function studentName(students: StudentSummary[], id: string, t: ReturnType<typeof useLang>['t']) {
  const s = students.find((x) => x.id === id)
  return s ? studentLabel(s, t) : ''
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
  const { t } = useLang()
  const { dataPoint: dp, item, studentId } = entry
  const [mode, setMode] = useState<'view' | 'correct'>('view')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [errs, setErrs] = useState<{ value?: string; reason?: string }>({})
  const [busy, setBusy] = useState(false)
  const fileKey = fileKeyOfSourceRef(dp.sourceRef)
  const isSample = !!fileKey && /sample-sheet-code/i.test(fileKey)
  const image = fileKey ? (cachedImage(fileKey) ?? (isSample ? SAMPLE_SHEET_URL : null)) : null
  const itemId = dp.sourceRef?.match(/#(.+)$/)?.[1] ?? null
  const row = isSample && itemId ? SAMPLE_ITEM_ROWS[itemId] : undefined

  async function confirm() {
    setBusy(true)
    try {
      await confirmReview(studentId, item.id, { expectedVersion: item.version })
      onDone(entry, t('capture.review.confirmedToast'))
    } catch (err) {
      onError(err)
      setBusy(false)
    }
  }
  async function correct(ev: React.FormEvent) {
    ev.preventDefault()
    const n = Number(value)
    const next = { value: value.trim() !== '' && Number.isFinite(n) ? undefined : t('capture.review.needValue'), reason: reason.trim() ? undefined : t('capture.review.needReason') }
    setErrs(next)
    if (next.value || next.reason) return
    setBusy(true)
    try {
      await correctDataPoint(studentId, dp.id, { expectedVersion: dp.version, value: n, reason: reason.trim() })
      onDone(entry, t('capture.review.correctedToast'))
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
          <StatusBadge tone="warning">{item.kind === 'low_confidence' ? t('capture.review.kindLow') : t('capture.review.kindSampled')}</StatusBadge>
          {dp.aiConfidence !== null && (
            <span className="text-small text-muted-foreground">{t('capture.review.confidence', { pct: Math.round(dp.aiConfidence * 100) })}</span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
          {image ? (
            <div className="flex flex-col gap-2">
              {row && (
                <div
                  role="img"
                  aria-label={t('capture.review.itemCrop', { item: itemId ?? '' })}
                  className="w-full rounded-md border border-border bg-white bg-no-repeat"
                  style={{ aspectRatio: `800 / ${row[1]}`, backgroundImage: `url(${image})`, backgroundSize: '100% auto', backgroundPosition: `0 ${(row[0] / (1000 - row[1])) * 100}%` }}
                />
              )}
              <details open={!row}>
                <summary className="cursor-pointer text-small font-semibold">{t('capture.review.fullSheet')}</summary>
                <img src={image} alt={t('capture.review.sourceImage')} className="mt-2 max-h-60 w-auto rounded-md border border-border" />
              </details>
            </div>
          ) : (
            <p className="text-small text-muted-foreground">{fileKey ? t('capture.review.noImage') : ''}</p>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-small text-muted-foreground">{t('capture.review.proposed')}</span>
            <span className="text-h2 font-extrabold">
              {Math.round(dp.value * 100) / 100} <span className="text-body font-normal">{dp.unit}</span>
            </span>
            {fileKey && <span className="text-small text-muted-foreground break-all">{t('capture.review.source', { key: fileKey })}</span>}
          </div>
        </div>
        {mode === 'view' ? (
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={confirm} loading={busy}>
              <CircleCheck aria-hidden />
              {t('capture.review.confirm')}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setMode('correct')} disabled={busy}>
              {t('capture.review.correct')}
            </Button>
          </div>
        ) : (
          <form onSubmit={correct} noValidate className="flex flex-col gap-4">
            <FormField label={t('capture.review.correctedValue')} required error={errs.value}>
              {(c: FormFieldControlProps) => <Input {...c} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
            </FormField>
            <FormField label={t('capture.review.reason')} required hint={t('capture.review.reasonHint')} error={errs.reason}>
              {(c: FormFieldControlProps) => <Input {...c} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </FormField>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" loading={busy}>
                {t('capture.review.save')}
              </Button>
              <Button type="button" size="lg" variant="ghost" onClick={() => setMode('view')} disabled={busy}>
                {t('capture.review.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </li>
  )
}
