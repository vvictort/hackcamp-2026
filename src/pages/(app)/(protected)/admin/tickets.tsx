/** School administrator: review IEP change tickets from case managers, then apply or decline each one. */
import { useState } from 'react'
import { TicketCheck } from 'lucide-react'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui'
import { useLang } from '@/i18n'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import { useLoad } from '@/lib/useLoad'
import { applyTicket, canDecline, declineTicket, listSchoolTickets, TICKET_TONE, type Ticket, type TicketFilter } from '@/lib/altamyra/tickets-api'

export default function TicketsPage() {
  return (
    <RoleGate path="/admin/tickets">
      <TicketsBody />
    </RoleGate>
  )
}

function TicketsBody() {
  const { t } = useLang()
  const toast = useToast()
  const [filter, setFilter] = useState<TicketFilter>('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [declining, setDeclining] = useState<Ticket | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(false)

  const list = useLoad(() => listSchoolTickets(filter), filter)
  const tickets = list.data

  const apply = async (tk: Ticket) => {
    setBusy(tk.id)
    try {
      await applyTicket(tk.id)
      toast.success(t('app.tickets.appliedToast'))
      list.reload()
    } catch {
      toast.error(t('app.tickets.failed'))
    } finally {
      setBusy(null)
    }
  }
  const decline = async () => {
    if (!declining) return
    if (!canDecline(reason)) return setReasonError(true)
    setBusy(declining.id)
    try {
      await declineTicket(declining.id, reason.trim())
      toast.success(t('app.tickets.declinedToast'))
      setDeclining(null)
      setReason('')
      list.reload()
    } catch {
      toast.error(t('app.tickets.failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('app.tickets.title')} description={t('app.tickets.description')} />
      <div role="group" aria-label={t('app.tickets.filter')} className="flex gap-2">
        {(['pending', 'all'] as const).map((f) => (
          <Button key={f} variant={f === filter ? 'default' : 'outline'} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {t(`app.tickets.${f}`)}
          </Button>
        ))}
      </div>

      {list.status === 'error' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-body text-destructive">
            {t('app.tickets.loadFailed')}
          </p>
          <Button variant="outline" onClick={list.reload}>
            {t('app.tickets.retry')}
          </Button>
        </div>
      ) : !tickets ? (
        <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
          <Spinner /> {t('app.tickets.loading')}
        </p>
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState className="py-10" icon={<TicketCheck aria-hidden />} title={t('app.tickets.empty')} description={t('app.tickets.emptyBody')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-6">
          {tickets.map((tk) => (
            <li key={tk.id}>
              <Card title={tk.studentLabel || t('app.tickets.student')}>
                <StatusBadge tone={TICKET_TONE[tk.status]}>{t(`app.tickets.status.${tk.status}`)}</StatusBadge>
                <dl className="grid gap-3 text-body">
                  <div>
                    <dt className="text-label font-semibold">{t('app.tickets.target')}</dt>
                    <dd>{tk.target}</dd>
                  </div>
                  <div>
                    <dt className="text-label font-semibold">{t('app.tickets.change')}</dt>
                    <dd className="whitespace-pre-line">{tk.proposedChange}</dd>
                  </div>
                  <div>
                    <dt className="text-label font-semibold">{t('app.tickets.reason')}</dt>
                    <dd className="whitespace-pre-line">{tk.reason}</dd>
                  </div>
                  {tk.declineReason && <dd className="text-small text-muted-foreground">{tk.declineReason}</dd>}
                </dl>
                {tk.status === 'pending' && (
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => void apply(tk)} loading={busy === tk.id} disabled={busy !== null}>
                      {t('app.tickets.apply')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => {
                        setReason('')
                        setReasonError(false)
                        setDeclining(tk)
                      }}
                    >
                      {t('app.tickets.decline')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('app.tickets.declineTitle')}</DialogTitle>
            <DialogDescription>{t('app.tickets.declineBody')}</DialogDescription>
          </DialogHeader>
          <FormField label={t('app.tickets.declineReason')} error={reasonError ? t('app.tickets.declineReasonNeeded') : undefined} required>
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setReasonError(false)
              }}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)}>
              {t('app.tickets.cancel')}
            </Button>
            <Button loading={busy !== null} onClick={() => void decline()}>
              {t('app.tickets.declineConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
