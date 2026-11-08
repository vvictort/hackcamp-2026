import type { TicketStatus, TicketView } from '@/server/altamyra/contract/plans'
import { apiFetch, emptyOn404, enc } from './api'

export type { TicketStatus }
export type Ticket = TicketView
export type TicketFilter = 'pending' | 'all'

export const listTickets = (studentId: string) => apiFetch<{ tickets: Ticket[] }>(`/students/${enc(studentId)}/tickets`)
export const createTicket = (studentId: string, body: { target: string; proposedChange: string; reason: string }) =>
  apiFetch<{ ticket: Ticket }>(`/students/${enc(studentId)}/tickets`, { body })

/** The school administrator's queue. */
export const listSchoolTickets = (filter: TicketFilter) =>
  emptyOn404(apiFetch<{ tickets: Ticket[] }>('/tickets', { query: { status: filter === 'pending' ? 'pending' : undefined } }).then((r) => r.tickets), [])
export const applyTicket = (id: string) => apiFetch(`/tickets/${enc(id)}/apply`, { body: {} })
export const declineTicket = (id: string, reason: string) => apiFetch(`/tickets/${enc(id)}/decline`, { body: { reason } })

export const TICKET_TONE = { pending: 'warning', applied: 'success', declined: 'destructive' } as const satisfies Record<TicketStatus, string>

/** Pending first, then newest first. */
export function sortTickets(list: Ticket[]): Ticket[] {
  const rank = (t: Ticket) => (t.status === 'pending' ? 0 : 1)
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export const ticketReady = (v: { target: string; proposedChange: string; reason: string }): boolean =>
  v.target.trim() !== '' && v.proposedChange.trim() !== '' && v.reason.trim() !== ''

/** Declining needs a short reason so the case manager knows why. */
export const canDecline = (reason: string) => reason.trim().length > 0
