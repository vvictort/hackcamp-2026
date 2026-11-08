import { useState } from 'react'
import { Button, FormField, Input, StatusBadge, useToast } from '@/components/ui'
import { PROFICIENCY_CHOICES, defaultPeriod, saveProficiency, suggestProficiency } from '@/lib/altamyra/profile-api'
import type { GoalStatusResponse } from '@/server/altamyra/contract/api'
import type { Proficiency } from '@/server/altamyra/contract/enums'
import { s, type SKey } from './text'

const levelLabel = (l: Proficiency) => (l === 'IE' ? s('students.prof.IE') : l)

/** Suggests a BC proficiency level with reasons; the teacher or case manager accepts or picks another, then saves. */
export function ProficiencyPanel({ studentId, goalId, status }: { studentId: string; goalId: string; status: GoalStatusResponse }) {
  const toast = useToast()
  const suggestion = suggestProficiency(status)
  const [level, setLevel] = useState<Proficiency>(suggestion.level)
  const [period, setPeriod] = useState(defaultPeriod())
  const [saved, setSaved] = useState<Proficiency | null>(null)
  const [busy, setBusy] = useState(false)
  const choices: Proficiency[] = [...PROFICIENCY_CHOICES, ...(suggestion.level === 'IE' ? (['IE'] as const) : [])]

  const save = async () => {
    setBusy(true)
    try {
      await saveProficiency(studentId, goalId, { level, period: period.trim() })
      setSaved(level)
      toast.success(s('students.prof.saved', { level: levelLabel(level) }))
    } catch (e) {
      toast.error(s('students.error.action'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={`prof-${goalId}`} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h3 id={`prof-${goalId}`} className="text-label font-semibold">{s('students.prof.title')}</h3>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">{s('students.prof.suggested', { level: levelLabel(suggestion.level) })}</StatusBadge>
        {saved && <StatusBadge tone="success">{s('students.prof.current', { level: levelLabel(saved) })}</StatusBadge>}
      </p>
      <ul className="list-disc ps-5 text-small text-muted-foreground">
        {suggestion.reasons.map((r) => (
          <li key={r.key}>{s(`students.prof.reason.${r.key}` as SKey, r.vars)}</li>
        ))}
      </ul>
      <p className="text-small">{s('students.prof.you')}</p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-label font-semibold">{s('students.prof.pick')}</legend>
        {choices.map((c) => (
          <label key={c} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="radio" name={`prof-level-${goalId}`} className="size-4" checked={level === c} onChange={() => setLevel(c)} />
            {levelLabel(c)}
          </label>
        ))}
      </fieldset>
      <FormField label={s('students.prof.period')}>
        <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
      </FormField>
      <div>
        <Button size="sm" loading={busy} disabled={!period.trim()} onClick={save}>{s('students.prof.save')}</Button>
      </div>
    </section>
  )
}
