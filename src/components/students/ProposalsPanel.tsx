import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { Button, Card, EmptyState, StatusBadge, Textarea, useToast } from '@/components/ui'
import { listMyProposals, resolveProposal } from '@/lib/altamira/students-api'
import { fmtDate, s } from './text'
import { useLoad } from './useLoad'

/** Proposals for this student. Case managers accept or decline open ones; teachers see their own and the outcome. */
export function ProposalsPanel({ studentId, canResolve, refreshKey, onResolved }: { studentId: string; canResolve: boolean; refreshKey: number; onResolved: () => void }) {
  const toast = useToast()
  const list = useLoad(() => listMyProposals(), `${studentId}:${refreshKey}`)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const resolve = async (pid: string, version: number, decision: 'accepted' | 'declined') => {
    setBusy(pid)
    try {
      await resolveProposal(pid, studentId, { expectedVersion: version, decision, note: notes[pid]?.trim() || null })
      toast.success(s(decision === 'accepted' ? 'students.proposals.acceptedToast' : 'students.proposals.declinedToast'))
      list.reload()
      onResolved()
    } catch (e) {
      toast.error(s('students.error.action'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const mine = list.status === 'ready' ? list.data.proposals.filter((p) => p.studentId === studentId) : []
  return (
    <Card title={s('students.proposals')}>
      {list.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
      {list.status === 'error' && <p role="alert" className="text-small">{list.error.message}</p>}
      {list.status === 'ready' && mine.length === 0 && (
        <EmptyState className="py-8" icon={<Inbox aria-hidden />} title={s('students.proposals.empty')} />
      )}
      <ul className="flex flex-col gap-3">
        {mine.map((p) => {
          const c = p.change as { newText?: unknown; reason?: unknown; goalId?: unknown }
          return (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{s(`students.propose.target.${p.target}` as const)}</span>
                {p.status === 'open' ? (
                  <StatusBadge tone="info">{s('students.proposals.open')}</StatusBadge>
                ) : p.status === 'accepted' ? (
                  <StatusBadge tone="success">{s('students.proposals.accepted')}</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">{s('students.proposals.declined')}</StatusBadge>
                )}
              </div>
              <p>{typeof c.newText === 'string' ? c.newText : JSON.stringify(p.change)}</p>
              {typeof c.reason === 'string' && c.reason && <p className="text-small text-muted-foreground">{c.reason}</p>}
              <p className="text-small text-muted-foreground">
                {fmtDate(p.createdAt)} · {s('students.proposals.evidence', { n: p.evidenceIds.length })}
              </p>
              {p.resolutionNote && <p className="text-small">{p.resolutionNote}</p>}
              {canResolve && p.status === 'open' && (
                <div className="flex flex-col gap-2">
                  <Textarea
                    aria-label={s('students.proposals.note')}
                    placeholder={s('students.proposals.note')}
                    rows={2}
                    value={notes[p.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" loading={busy === p.id} onClick={() => resolve(p.id, p.version, 'accepted')}>{s('students.proposals.accept')}</Button>
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => resolve(p.id, p.version, 'declined')}>{s('students.proposals.decline')}</Button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
