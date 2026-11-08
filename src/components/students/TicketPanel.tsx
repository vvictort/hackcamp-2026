import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import {
  Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusBadge, Textarea, useToast,
} from '@/components/ui'
import { createTicket, listTickets, sortTickets, ticketReady, TICKET_TONE, type TicketStatus } from '@/lib/altamyra/tickets-api'
import { fmtDate, s } from './text'
import { useLoad } from './useLoad'

const LABEL: Record<TicketStatus, 'ticket.pending' | 'ticket.applied' | 'ticket.declined'> = {
  pending: 'ticket.pending',
  applied: 'ticket.applied',
  declined: 'ticket.declined',
}

export type TicketTarget = { value: string; label: string }

/** Case manager: suggest an IEP change as a ticket, and see this student's tickets. No direct edit. */
export function TicketPanel({ studentId, targets }: { studentId: string; targets: TicketTarget[] }) {
  const toast = useToast()
  const list = useLoad(() => listTickets(studentId), studentId)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [change, setChange] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (v: boolean) => {
    setOpen(v)
    if (!v) {
      setTarget('')
      setChange('')
      setReason('')
      setError(null)
    }
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await createTicket(studentId, { target, proposedChange: change.trim(), reason: reason.trim() })
      toast.success(s('ticket.sent'))
      close(false)
      list.reload()
    } catch {
      setError(s('ticket.failed'))
    } finally {
      setBusy(false)
    }
  }
  const tickets = list.status === 'ready' ? sortTickets(list.data.tickets) : []
  const labelOf = (t: string) => targets.find((x) => x.value === t)?.label ?? t

  return (
    <Card title={s('ticket.title')}>
      <p className="text-small text-muted-foreground">{s('ticket.confirmedNote')}</p>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}><MessageSquarePlus aria-hidden />{s('ticket.suggest')}</Button>
      </div>
      {list.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
      {list.status === 'error' && (
        <p role="alert" className="text-small">
          {list.error.message}{' '}
          <button type="button" className="font-semibold underline" onClick={list.reload}>{s('students.retry')}</button>
        </p>
      )}
      {list.status === 'ready' && tickets.length === 0 && <p className="text-small text-muted-foreground">{s('ticket.empty')}</p>}
      {tickets.length > 0 && (
        <ul className="flex flex-col gap-3">
          {tickets.map((t) => (
            <li key={t.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-body">{labelOf(t.target)}</strong>
                <StatusBadge tone={TICKET_TONE[t.status]}>{s(LABEL[t.status])}</StatusBadge>
              </span>
              <span className="text-body">{t.proposedChange}</span>
              <span className="text-small text-muted-foreground">{t.reason}{t.createdAt ? ` - ${fmtDate(t.createdAt)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s('ticket.suggest')}</DialogTitle>
            <DialogDescription>{s('ticket.intro')}</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (ticketReady({ target, proposedChange: change, reason }) && !busy) void submit() }}>
            <FormField label={s('ticket.target')} required>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger aria-label={s('ticket.target')}><SelectValue placeholder={s('ticket.targetPick')} /></SelectTrigger>
                <SelectContent>
                  {targets.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={s('ticket.change')} required>
              <Textarea rows={3} value={change} onChange={(e) => setChange(e.target.value)} />
            </FormField>
            <FormField label={s('ticket.reason')} required>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            {error && <p role="alert" className="text-small text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>{s('students.cancel')}</Button>
              <Button type="submit" loading={busy} disabled={busy || !ticketReady({ target, proposedChange: change, reason })}>{s('ticket.submit')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
