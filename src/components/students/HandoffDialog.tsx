import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormField, Input, useToast } from '@/components/ui'
import { createHandoff, getHandoff } from '@/lib/altamira/profile-api'
import type { Handoff } from '@/server/altamira/contract/student'
import { s } from './text'

export const handoffLink = (origin: string, studentId: string, handoffId: string) => `${origin}/students/${encodeURIComponent(studentId)}?handoff=${encodeURIComponent(handoffId)}`

function Packet({ handoff }: { handoff: Handoff }) {
  const p = handoff.packet
  return (
    <div className="flex max-h-[55vh] flex-col gap-4 overflow-auto" data-testid="handoff-packet">
      {handoff.toSchool && <p className="text-small text-muted-foreground">{s('students.handoff.to', { school: handoff.toSchool })}</p>}
      <section aria-labelledby="ho-goals" className="flex flex-col gap-2">
        <h3 id="ho-goals" className="text-label font-semibold">{s('students.handoff.goals')}</h3>
        {p.goals.length === 0 && <p className="text-small">{s('students.handoff.none')}</p>}
        <ul className="flex flex-col gap-2">
          {p.goals.map((g) => (
            <li key={g.goalId} className="rounded-md border border-border p-3">
              <p className="font-semibold">{g.area}</p>
              <p>{g.text}</p>
              <p className="text-small text-muted-foreground">
                {g.trend && s('students.handoff.trend', { trend: g.trend })} {g.proficiency && s('students.handoff.proficiency', { level: g.proficiency })}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ho-ww" className="flex flex-col gap-2">
        <h3 id="ho-ww" className="text-label font-semibold">{s('students.handoff.whatWorks')}</h3>
        {p.whatWorks.length === 0 && <p className="text-small">{s('students.handoff.none')}</p>}
        <ul className="list-disc ps-5">
          {p.whatWorks.map((w) => (
            <li key={w.adaptationType}>{s('students.handoff.whatWorksRow', { type: w.adaptationType.replace(/_/g, ' '), n: w.n, mean: w.meanOutcome === null ? '-' : w.meanOutcome })}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ho-next" className="flex flex-col gap-2">
        <h3 id="ho-next" className="text-label font-semibold">{s('students.handoff.next')}</h3>
        {p.suggestedNextGoals.length === 0 && <p className="text-small">{s('students.handoff.none')}</p>}
        <ul className="list-disc ps-5">{p.suggestedNextGoals.map((g) => <li key={g}>{g}</li>)}</ul>
      </section>
    </div>
  )
}

interface Props {
  studentId: string
  /** Case manager can create; anyone with access can open one by id. */
  canCreate: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog opens this handoff instead of the create form. */
  handoffId?: string | null
}

/** Create a transition handoff packet (case manager), or open one by id (receiver, via the link). */
export function HandoffDialog({ studentId, canCreate, open, onOpenChange, handoffId }: Props) {
  const toast = useToast()
  const [toSchool, setToSchool] = useState('')
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !handoffId) return
    let live = true
    setBusy(true)
    setError(null)
    getHandoff(studentId, handoffId)
      .then((r) => live && setHandoff(r.handoff))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : s('students.handoff.loadFailed')))
      .finally(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [open, handoffId, studentId])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await createHandoff(studentId, toSchool.trim() || null)
      setHandoff(r.handoff)
      toast.success(s('students.handoff.created'))
    } catch (e) {
      setError(e instanceof Error ? e.message : s('students.error.action'))
    } finally {
      setBusy(false)
    }
  }

  const link = handoff ? handoffLink(window.location.origin, studentId, handoff.id) : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(s('students.handoff.copied'))
    } catch {
      /* the link stays visible to copy by hand */
    }
  }
  const close = (v: boolean) => {
    if (!v) {
      setHandoff(null)
      setError(null)
      setToSchool('')
    }
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{s('students.handoff')}</DialogTitle>
          <DialogDescription>{s('students.handoff.help')}</DialogDescription>
        </DialogHeader>
        {!handoff && canCreate && !handoffId && (
          <FormField label={s('students.handoff.toSchool')}>
            <Input value={toSchool} onChange={(e) => setToSchool(e.target.value)} />
          </FormField>
        )}
        {busy && !handoff && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
        {handoff && (
          <>
            <Packet handoff={handoff} />
            {canCreate && (
              <div className="flex flex-col gap-2">
                <FormField label={s('students.handoff.link')}>
                  <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                </FormField>
                <div><Button variant="outline" size="sm" onClick={copy}>{s('students.handoff.copy')}</Button></div>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="text-small font-semibold text-destructive-strong">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{s('students.handoff.close')}</Button>
          {!handoff && canCreate && !handoffId && <Button loading={busy} onClick={create}>{s('students.handoff.create')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
