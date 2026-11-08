import { useState } from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { Button, Card, FormField, Textarea, type FormFieldControlProps } from '@/components/ui'
import { sendNote } from '@/lib/altamyra/capture-api'
import { getCaptureObjectives, type CaptureObjective } from '@/lib/altamyra/practice-api'
import { capture } from '@/i18n/en/capture'
import { useLoad } from '@/lib/useLoad'
import { SELECT_CLASS } from './StudentSelect'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'

export function goalName(o: CaptureObjective, i: number, t: ReturnType<typeof useLang>['t']): string {
  const key = `capture.ea.metric.${o.metricType}` as MessageKey
  const metric = key in capture ? t(key) : o.metricType.replace('_', ' ')
  return t('capture.ea.goalLabel', { n: i + 1, metric, unit: o.unit })
}

/** Optional goal choice. Goals that fail to load just leave the choice at "not about one goal". */
export function ObjectivePicker({ studentId, value, onChange }: { studentId: string; value: string; onChange: (id: string) => void }) {
  const { t } = useLang()
  const goals = useLoad(() => getCaptureObjectives(studentId), studentId).data?.objectives ?? []
  if (goals.length === 0) return null
  return (
    <FormField label={t('capture.note.goal')}>
      {(c: FormFieldControlProps) => (
        <select {...c} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('capture.note.noGoal')}</option>
          {goals.map((o, i) => (
            <option key={o.objectiveId} value={o.objectiveId}>
              {goalName(o, i, t)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  )
}

export function NoteCapture({ studentId, onSaved }: { studentId: string; onSaved?: () => void }) {
  const { t } = useLang()
  const [goal, setGoal] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return setStatus({ ok: false, text: t('capture.note.missing') })
    setBusy(true)
    try {
      await sendNote(studentId, text, goal || null)
      setStatus({ ok: true, text: t('capture.note.saved') })
      setText('')
      onSaved?.()
    } catch {
      setStatus({ ok: false, text: t('capture.note.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <ObjectivePicker studentId={studentId} value={goal} onChange={setGoal} />
        <FormField label={t('capture.note.text')}>
          {(c: FormFieldControlProps) => <Textarea {...c} rows={4} value={text} onChange={(e) => setText(e.target.value)} />}
        </FormField>
        {status && (
          <p role={status.ok ? 'status' : 'alert'} className="flex items-center gap-2 text-small font-semibold">
            {status.ok ? <CircleCheck aria-hidden className="size-5" /> : <CircleX aria-hidden className="size-5" />}
            {status.text}
          </p>
        )}
        <div>
          <Button type="submit" size="lg" loading={busy}>
            {t('capture.note.send')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
