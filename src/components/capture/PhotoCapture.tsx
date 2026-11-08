import { useEffect, useState } from 'react'
import { Camera, FlaskConical } from 'lucide-react'
import { Button, buttonVariants, Card, FormField, Input, StatusBadge, type FormFieldControlProps } from '@/components/ui'
import type { CaptureBatch } from '@/server/altamyra/contract/school'
import type { DataPoint } from '@/server/altamyra/contract/student'
import {
  getDataPointSource,
  normalizeSheetCode,
  photoMedia,
  pollBatch,
  rememberImage,
  uploadPhotos,
} from '@/lib/altamyra/capture-api'
import { blobToBase64 } from '@/lib/altamyra/capture-api'
import { useAltamyraMe } from '@/lib/altamyra/role'
import { createSampleSheet, PracticeApiError, sampleFileKey } from '@/lib/altamyra/practice-api'
import { SAMPLE_SHEET_URL, stampSheetCode } from './stampSheetCode'
import { StudentSelect } from './StudentSelect'
import { useCt } from './useCt'
import { useStudents } from './useStudents'

type Scored = { page: number; status: 'scored' | 'unreadable' | 'failed' | 'processing'; points: DataPoint[]; studentId: string | null }

async function describePages(batch: CaptureBatch): Promise<Scored[]> {
  const out: Scored[] = []
  for (const [i, p] of batch.pages.entries()) {
    const points: DataPoint[] = []
    if (p.status === 'scored' && p.studentId) {
      for (const id of p.dataPointIds) {
        try {
          points.push((await getDataPointSource(p.studentId, id)).dataPoint)
        } catch {
          /* a point the user cannot read is skipped */
        }
      }
    }
    out.push({
      page: i + 1,
      studentId: p.studentId,
      points,
      status: p.status === 'scored' ? 'scored' : p.status === 'unreadable_code' ? 'unreadable' : batch.status === 'processing' ? 'processing' : 'failed',
    })
  }
  return out
}

export function PhotoCapture({ studentId: fixedStudent, onScored }: { studentId?: string; onScored?: () => void } = {}) {
  const ct = useCt()
  const { students, state, reload } = useStudents()
  const [pickedStudent, setStudentId] = useState('')
  const studentId = fixedStudent ?? pickedStudent
  const [code, setCode] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ code?: string; photo?: string; submit?: string }>({})
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Scored[] | null>(null)
  const [sample, setSample] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleNote, setSampleNote] = useState<{ ok: boolean; text: string } | null>(null)
  const { devEnabled } = useAltamyraMe()

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sheetCode = normalizeSheetCode(code)
    const next = { code: sheetCode ? undefined : ct('capture.photo.sheetCodeInvalid'), photo: file ? undefined : ct('capture.photo.photoMissing') }
    setErrors(next)
    if (!sheetCode || !file) return
    setBusy(true)
    try {
      const media = sample
        ? { fileKey: sampleFileKey(sheetCode), contentType: 'image/png', bytesBase64: await blobToBase64(file) }
        : await photoMedia(file, sheetCode)
      rememberImage(media.fileKey, `data:${media.contentType};base64,${media.bytesBase64}`)
      const created = await uploadPhotos([media])
      const done = created.batch.status === 'processing' ? await pollBatch(created.batch.id) : created
      setResults(await describePages(done.batch))
      onScored?.()
    } catch {
      setErrors({ submit: ct('capture.photo.failed') })
    } finally {
      setBusy(false)
    }
  }

  async function useSample() {
    setSampleNote(null)
    if (!studentId) return setSampleNote({ ok: false, text: ct('capture.photo.sampleNeedsStudent') })
    setSampleBusy(true)
    try {
      const made = await createSampleSheet(studentId)
      const res = await fetch(SAMPLE_SHEET_URL)
      const stamped = await stampSheetCode(await res.blob(), made.code)
      setFile(new File([stamped], 'sample-sheet.png', { type: 'image/png' }))
      setCode(made.code)
      setSample(true)
      setErrors({})
      setSampleNote({ ok: true, text: ct('capture.photo.sampleReady', { code: made.code }) })
    } catch (err) {
      setSampleNote({ ok: false, text: ct(err instanceof PracticeApiError && err.status === 404 ? 'capture.photo.sampleUnavailable' : 'capture.photo.sampleFailed') })
    } finally {
      setSampleBusy(false)
    }
  }

  function reset() {
    setSample(false)
    setSampleNote(null)
    setResults(null)
    setFile(null)
    setCode('')
    setErrors({})
  }

  if (state === 'error')
    return (
      <Card>
        <p role="alert">{ct('capture.common.loadFailed')}</p>
        <div>
          <Button onClick={reload}>{ct('capture.common.retry')}</Button>
        </div>
      </Card>
    )

  if (results)
    return (
      <Card title={ct('capture.photo.results')} aria-live="polite">
        <ul className="flex flex-col gap-3">
          {results.map((r) => (
            <li key={r.page} className="flex flex-col gap-2 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <strong>{ct('capture.photo.page', { n: r.page })}</strong>
                <ResultBadge r={r} ct={ct} />
              </div>
              {studentId && r.studentId && r.studentId !== studentId && (
                <p className="text-small text-muted-foreground">{ct('capture.photo.wrongStudent')}</p>
              )}
              {r.points.map((p) => (
                <p key={p.id} className="text-small text-muted-foreground">
                  {ct('capture.photo.value', { value: Math.round(p.value * 100) / 100 })}
                  {p.aiConfidence !== null && <> · {ct('capture.photo.confidence', { pct: Math.round(p.aiConfidence * 100) })}</>}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          {results.some((r) => r.points.some((p) => p.status === 'pending_review')) && (
            <a href="#to-confirm" className={buttonVariants({ size: 'lg' })}>
              {ct('capture.photo.goReview')}
            </a>
          )}
          <Button variant="secondary" size="lg" onClick={reset}>
            {ct('capture.photo.another')}
          </Button>
        </div>
      </Card>
    )

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {state === 'ready' && students.length === 0 && <p>{ct('capture.common.noStudents')}</p>}
        {fixedStudent === undefined && <StudentSelect students={students} value={studentId} onChange={setStudentId} />}
        <FormField label={ct('capture.photo.sheetCode')} required hint={ct('capture.photo.sheetCodeHint')} error={errors.code}>
          {(control: FormFieldControlProps) => (
            <Input {...control} value={code} onChange={(e) => {
                setCode(e.target.value)
                setSample(false)
              }}
              autoCapitalize="characters" autoComplete="off" placeholder="AL-K7Q4L1" />
          )}
        </FormField>
        <FormField label={ct('capture.photo.photo')} required hint={ct('capture.photo.photoHint')} error={errors.photo}>
          {(control: FormFieldControlProps) => (
            <Input {...control} type="file" accept="image/*" capture="environment" className="h-auto min-h-12 py-3" onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setSample(false)
              }} />
          )}
        </FormField>
        {preview && <img src={preview} alt={ct(sample ? 'capture.photo.samplePreview' : 'capture.photo.preview')} className="max-h-72 w-auto self-start rounded-md border border-border" />}
        {errors.submit && (
          <p role="alert" className="text-destructive-strong">
            {errors.submit}
          </p>
        )}
        <div>
          <Button type="submit" size="lg" className="min-h-12" loading={busy}>
            <Camera aria-hidden />
            {busy ? ct('capture.photo.scoring') : ct('capture.photo.submit')}
          </Button>
        </div>
        <p className="text-small text-muted-foreground">{ct('capture.photo.sample')}</p>
        {devEnabled && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-4">
            <div>
              <Button type="button" variant="outline" size="lg" className="min-h-12" onClick={useSample} loading={sampleBusy}>
                <FlaskConical aria-hidden />
                {sampleBusy ? ct('capture.photo.sampleLoading') : ct('capture.photo.useSample')}
              </Button>
            </div>
            <p className="text-small text-muted-foreground">{ct('capture.photo.useSampleHint')}</p>
            {sampleNote && (
              <p role={sampleNote.ok ? 'status' : 'alert'} className={sampleNote.ok ? 'text-small font-semibold' : 'text-small font-semibold text-destructive-strong'}>
                {sampleNote.text}
              </p>
            )}
          </div>
        )}
      </form>
    </Card>
  )
}

function ResultBadge({ r, ct }: { r: Scored; ct: ReturnType<typeof useCt> }) {
  if (r.status === 'unreadable') return <StatusBadge tone="destructive">{ct('capture.photo.unreadable')}</StatusBadge>
  if (r.status === 'failed') return <StatusBadge tone="destructive">{ct('capture.photo.pageFailed')}</StatusBadge>
  if (r.status === 'processing') return <StatusBadge tone="info">{ct('capture.photo.processing')}</StatusBadge>
  if (r.points.some((p) => p.status === 'pending_review'))
    return <StatusBadge tone="warning">{ct('capture.photo.sentToReview')}</StatusBadge>
  return <StatusBadge tone="success">{ct('capture.photo.confirmed')}</StatusBadge>
}
