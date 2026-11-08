import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import { createTicket, listTickets, sortTickets, ticketReady, type IepTicket } from './tickets-api'

const t = (o: Partial<IepTicket>): IepTicket => ({ id: 'x', studentId: 's', target: 'g', proposedChange: 'p', reason: 'r', status: 'pending', createdAt: '2026-11-01', ...o })
afterEach(() => vi.unstubAllGlobals())

describe('tickets-api', () => {
  it('sorts pending first then newest', () => {
    const l = sortTickets([t({ id: 'a', status: 'applied', createdAt: '2026-11-05' }), t({ id: 'b', createdAt: '2026-11-01' }), t({ id: 'c', createdAt: '2026-11-03' })])
    expect(l.map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })
  it('needs all three fields', () => {
    expect(ticketReady({ target: 'a', proposedChange: 'b', reason: 'c' })).toBe(true)
    expect(ticketReady({ target: 'a', proposedChange: ' ', reason: 'c' })).toBe(false)
  })
  it('posts and lists', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await createTicket('s1', { target: 'a', proposedChange: 'b', reason: 'c' })
    await listTickets('s1')
    const calls = f.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][0]).toBe('/api/v1/students/s1/tickets')
    expect(calls[0][1].method).toBe('POST')
    expect(calls[1][1].method).toBe('GET')
  })
})
