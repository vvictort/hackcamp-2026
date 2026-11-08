import { apiFetch } from './students-api'

const seg = encodeURIComponent

export type TicketStatus = 'pending' | 'applied' | 'declined'
export type IepTicket = {
  id: string
  studentId: string
  target: string
  proposedChange: string
  reason: string
  status: TicketStatus
  createdAt?: string
  decidedAt?: string | null
  decisionNote?: string | null
}

export const listTickets = (studentId: string) => apiFetch<{ tickets: IepTicket[] }>(`/students/${seg(studentId)}/tickets`)
export const createTicket = (studentId: string, body: { target: string; proposedChange: string; reason: string }) =>
  apiFetch<{ ticket: IepTicket }>(`/students/${seg(studentId)}/tickets`, { method: 'POST', body })

export const TICKET_TONE = { pending: 'info', applied: 'success', declined: 'warning' } as const

/** Pending first, then newest first. */
export function sortTickets(list: IepTicket[]): IepTicket[] {
  const rank = (t: IepTicket) => (t.status === 'pending' ? 0 : 1)
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export const ticketReady = (v: { target: string; proposedChange: string; reason: string }): boolean =>
  v.target.trim() !== '' && v.proposedChange.trim() !== '' && v.reason.trim() !== ''
