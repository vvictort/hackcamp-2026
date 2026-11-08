import { useState } from 'react'
import { Button, Card, FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, useToast } from '@/components/ui'
import { createProposal } from '@/lib/altamira/students-api'
import type { DataPoint, Goal } from '@/server/altamira/contract/student'
import { fmtDate, s } from './text'

const NO_GOAL = '__none__'
const TARGETS = ['iep', 'profile', 'objective'] as const

/** Teacher proposes an IEP, profile or objective change, with optional evidence data points. */
export function ProposalForm({ studentId, goals, dataPoints, onSent }: { studentId: string; goals: Goal[]; dataPoints: DataPoint[]; onSent: () => void }) {
  const toast = useToast()
  const [target, setTarget] = useState<(typeof TARGETS)[number]>('iep')
  const [goalId, setGoalId] = useState(NO_GOAL)
  const [newText, setNewText] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const recent = [...dataPoints].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 6)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await createProposal(studentId, {
        target,
        change: { ...(goalId !== NO_GOAL ? { goalId } : {}), newText: newText.trim(), reason: reason.trim() },
        evidenceIds: evidence,
      })
      toast.success(s('students.propose.sent'))
      setNewText('')
      setReason('')
      setEvidence([])
      onSent()
    } catch (err) {
      toast.error(s('students.error.action'), err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={s('students.propose')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormField label={s('students.propose.target')}>
          {(c) => (
            <Select value={target} onValueChange={(v) => setTarget(v as typeof target)}>
              <SelectTrigger {...c}><SelectValue /></SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t} value={t}>{s(`students.propose.target.${t}` as const)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label={s('students.propose.goal')}>
          {(c) => (
            <Select value={goalId} onValueChange={setGoalId}>
              <SelectTrigger {...c}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GOAL}>{s('students.propose.noGoal')}</SelectItem>
                {goals.map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.area}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label={s('students.propose.change')} required>
          <Textarea value={newText} onChange={(e) => setNewText(e.target.value)} rows={3} />
        </FormField>
        <FormField label={s('students.propose.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </FormField>
        {recent.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-semibold">{s('students.propose.evidence')}</legend>
            {recent.map((p) => (
              <label key={p.id} className="flex min-h-11 items-center gap-2 text-body">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={evidence.includes(p.id)}
                  onChange={(e) => setEvidence((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                />
                {p.value} {p.unit} · {fmtDate(p.recordedAt)}
              </label>
            ))}
          </fieldset>
        )}
        <div>
          <Button type="submit" loading={busy} disabled={!newText.trim()}>{s('students.propose.submit')}</Button>
        </div>
      </form>
    </Card>
  )
}
