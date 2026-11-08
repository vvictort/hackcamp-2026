import { useState } from 'react'
import { CircleCheck, CircleX, Video } from 'lucide-react'
import { Button, Card, FormField, Input, type FormFieldControlProps } from '@/components/ui'
import { captureErrorKind, MAX_VIDEO_BYTES, sendVideo, useCaptureUpload } from '@/lib/altamyra/capture-api'
import { ObjectivePicker } from './NoteCapture'
import { useLang } from '@/i18n'

export function VideoCapture({ studentId, onSaved }: { studentId: string; onSaved?: () => void }) {
  const { t } = useLang()
  const [file, setFile] = useState<File | null>(null)
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [inputKey, setInputKey] = useState(0)
  const upload = useCaptureUpload()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return setStatus({ ok: false, text: t('capture.video.missing') })
    if (file.size > MAX_VIDEO_BYTES) return setStatus({ ok: false, text: t('capture.video.tooBig') })
    setBusy(true)
    try {
      await sendVideo(studentId, file, goal || null, Date.now(), upload)
      setStatus({ ok: true, text: t('capture.video.saved') })
      setFile(null)
      setInputKey((k) => k + 1)
      onSaved?.()
    } catch (err) {
      setStatus({ ok: false, text: t(captureErrorKind(err) === 'consent' ? 'capture.video.noConsent' : 'capture.video.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormField label={t('capture.video.file')} hint={t('capture.video.hint')}>
          {(c: FormFieldControlProps) => (
            <Input
              {...c}
              key={inputKey}
              type="file"
              accept="video/*"
              capture="environment"
              className="h-auto min-h-12 py-3"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setStatus(null)
              }}
            />
          )}
        </FormField>
        <ObjectivePicker studentId={studentId} value={goal} onChange={setGoal} />
        {status && (
          <p role={status.ok ? 'status' : 'alert'} className="flex items-center gap-2 text-small font-semibold">
            {status.ok ? <CircleCheck aria-hidden className="size-5" /> : <CircleX aria-hidden className="size-5" />}
            {status.text}
          </p>
        )}
        <div>
          <Button type="submit" size="lg" loading={busy}>
            <Video aria-hidden />
            {busy ? t('capture.video.sending') : t('capture.video.send')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
