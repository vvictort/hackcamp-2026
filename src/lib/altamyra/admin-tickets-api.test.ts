import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: async () => null }))
import { canDecline, declineTicket, listTickets } from './admin-tickets-api'

afterEach(() => vi.unstubAllGlobals())

describe('tickets api', () => {
  it('filters pending and tolerates 404', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', f)
    expect(await listTickets('pending')).toEqual([])
    expect((f.mock.calls as unknown as string[][])[0][0]).toBe('/api/v1/tickets?status=pending')
  })
  it('requires a reason to decline', async () => {
    expect(canDecline('  ')).toBe(false)
    expect(canDecline('Not needed')).toBe(true)
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    await declineTicket('t 1', 'why')
    expect((f.mock.calls as unknown as string[][])[0][0]).toBe('/api/v1/tickets/t%201/decline')
  })
})
