import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import {
  Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StatusBadge, Textarea, useToast,
} from '@/components/ui'
import { createTicket, listTickets, sortTickets, ticketReady, TICKET_TONE, type TicketStatus } from '@/lib/altamyra/tickets-api'
import { fmtDate } from './text'
import { LoadError, useLoad } from '@/lib/useLoad'
import { useLang } from '@/i18n'

const LABEL: Record<TicketStatus, 'ticket.pending' | 'ticket.applied' | 'ticket.declined'> = {
  pending: 'ticket.pending',
  applied: 'ticket.applied',
  declined: 'ticket.declined',
}

export type TicketTarget = { value: string; label: string }

/** Case manager: suggest an IEP change as a ticket, and see this student's tickets. No direct edit. */
export function TicketPanel({ studentId, targets }: { studentId: string; targets: TicketTarget[] }) {
  const { t } = useLang()
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
      toast.success(t('ticket.sent'))
      close(false)
      list.reload()
    } catch {
      setError(t('ticket.failed'))
    } finally {
      setBusy(false)
    }
  }
  const tickets = list.status === 'ready' ? sortTickets(list.data.tickets) : []
  const labelOf = (target: string) => targets.find((x) => x.value === target)?.label ?? target

  return (
    <Card title={t('ticket.title')}>
      <p className="text-small text-muted-foreground">{t('ticket.confirmedNote')}</p>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}><MessageSquarePlus aria-hidden />{t('ticket.suggest')}</Button>
      </div>
      {list.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{t('students.loading')}</p>}
      {list.status === 'error' && <LoadError error={list.error} onRetry={list.reload} />}
      {list.status === 'ready' && tickets.length === 0 && <p className="text-small text-muted-foreground">{t('ticket.empty')}</p>}
      {tickets.length > 0 && (
        <ul className="flex flex-col gap-3">
          {tickets.map((tk) => (
            <li key={tk.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-body">{labelOf(tk.target)}</strong>
                <StatusBadge tone={TICKET_TONE[tk.status]}>{t(LABEL[tk.status])}</StatusBadge>
              </span>
              <span className="text-body">{tk.proposedChange}</span>
              <span className="text-small text-muted-foreground">{tk.reason}{tk.createdAt ? ` - ${fmtDate(tk.createdAt)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ticket.suggest')}</DialogTitle>
            <DialogDescription>{t('ticket.intro')}</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (ticketReady({ target, proposedChange: change, reason }) && !busy) void submit() }}>
            <FormField label={t('ticket.target')} required>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger aria-label={t('ticket.target')}><SelectValue placeholder={t('ticket.targetPick')} /></SelectTrigger>
                <SelectContent>
                  {targets.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t('ticket.change')} required>
              <Textarea rows={3} value={change} onChange={(e) => setChange(e.target.value)} />
            </FormField>
            <FormField label={t('ticket.reason')} required>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            {error && <p role="alert" className="text-small text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>{t('students.cancel')}</Button>
              <Button type="submit" loading={busy} disabled={busy || !ticketReady({ target, proposedChange: change, reason })}>{t('ticket.submit')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
