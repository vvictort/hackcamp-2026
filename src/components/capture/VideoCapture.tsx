import { useState } from 'react'
import { CircleCheck, CircleX, Video } from 'lucide-react'
import { Button, Card, FormField, Input, type FormFieldControlProps } from '@/components/ui'
import { captureErrorKind, MAX_VIDEO_BYTES, sendVideo } from '@/lib/altamira/capture-api'
import { ObjectivePicker } from './NoteCapture'
import { useCt } from './useCt'

export function VideoCapture({ studentId, onSaved }: { studentId: string; onSaved?: () => void }) {
  const ct = useCt()
  const [file, setFile] = useState<File | null>(null)
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [inputKey, setInputKey] = useState(0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return setStatus({ ok: false, text: ct('capture.video.missing') })
    if (file.size > MAX_VIDEO_BYTES) return setStatus({ ok: false, text: ct('capture.video.tooBig') })
    setBusy(true)
    try {
      await sendVideo(studentId, file, goal || null)
      setStatus({ ok: true, text: ct('capture.video.saved') })
      setFile(null)
      setInputKey((k) => k + 1)
      onSaved?.()
    } catch (err) {
      setStatus({ ok: false, text: ct(captureErrorKind(err) === 'consent' ? 'capture.video.noConsent' : 'capture.video.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormField label={ct('capture.video.file')} hint={ct('capture.video.hint')}>
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
            {busy ? ct('capture.video.sending') : ct('capture.video.send')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
