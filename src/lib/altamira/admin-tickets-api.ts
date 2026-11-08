/** IEP change tickets for the school administrator. */
import { ApiError, apiGet, apiPost } from './api'

export type TicketStatus = 'pending' | 'applied' | 'declined'
export type Ticket = {
  id: string
  studentId: string
  label?: string | null
  target: string
  proposedChange: string
  reason: string
  status: TicketStatus
  outcome?: string | null
  createdAt?: string
}

export type TicketFilter = 'pending' | 'all'

export async function listTickets(filter: TicketFilter): Promise<Ticket[]> {
  try {
    const r = await apiGet<unknown>(filter === 'pending' ? '/tickets?status=pending' : '/tickets')
    const rows = Array.isArray(r) ? r : (r as { tickets?: Ticket[] } | null)?.tickets
    return Array.isArray(rows) ? (rows as Ticket[]) : []
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return []
    throw e
  }
}

export const applyTicket = (id: string) => apiPost(`/tickets/${encodeURIComponent(id)}/apply`, {})
export const declineTicket = (id: string, reason: string) => apiPost(`/tickets/${encodeURIComponent(id)}/decline`, { reason })

/** Declining needs a short reason so the case manager knows why. */
export const canDecline = (reason: string) => reason.trim().length > 0
