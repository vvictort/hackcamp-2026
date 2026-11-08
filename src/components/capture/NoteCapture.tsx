import { useEffect, useState } from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { Button, Card, FormField, Textarea, type FormFieldControlProps } from '@/components/ui'
import { sendNote } from '@/lib/altamyra/capture-api'
import { getCaptureObjectives, type CaptureObjective } from '@/lib/altamyra/practice-api'
import { capture } from '@/i18n/en/capture'
import { SELECT_CLASS } from './StudentSelect'
import { useCt, type CaptureKey } from './useCt'

export function goalName(o: CaptureObjective, i: number, ct: ReturnType<typeof useCt>): string {
  const key = `capture.ea.metric.${o.metricType}` as CaptureKey
  const metric = key in capture ? ct(key) : o.metricType.replace('_', ' ')
  return ct('capture.ea.goalLabel', { n: i + 1, metric, unit: o.unit })
}

/** Optional goal choice. Goals that fail to load just leave the choice at "not about one goal". */
export function ObjectivePicker({ studentId, value, onChange }: { studentId: string; value: string; onChange: (id: string) => void }) {
  const ct = useCt()
  const [goals, setGoals] = useState<CaptureObjective[]>([])
  useEffect(() => {
    let live = true
    setGoals([])
    getCaptureObjectives(studentId)
      .then((r) => live && setGoals(r.objectives))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [studentId])
  if (goals.length === 0) return null
  return (
    <FormField label={ct('capture.note.goal')}>
      {(c: FormFieldControlProps) => (
        <select {...c} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{ct('capture.note.noGoal')}</option>
          {goals.map((o, i) => (
            <option key={o.objectiveId} value={o.objectiveId}>
              {goalName(o, i, ct)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  )
}

export function NoteCapture({ studentId, onSaved }: { studentId: string; onSaved?: () => void }) {
  const ct = useCt()
  const [goal, setGoal] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return setStatus({ ok: false, text: ct('capture.note.missing') })
    setBusy(true)
    try {
      await sendNote(studentId, text, goal || null)
      setStatus({ ok: true, text: ct('capture.note.saved') })
      setText('')
      onSaved?.()
    } catch {
      setStatus({ ok: false, text: ct('capture.note.failed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <ObjectivePicker studentId={studentId} value={goal} onChange={setGoal} />
        <FormField label={ct('capture.note.text')}>
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
            {ct('capture.note.send')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
