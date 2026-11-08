import type { Hono } from 'hono'
import { z } from 'zod'
import { AltamyraError } from '../contract/errors'
import type { AltamyraEnv } from '../middleware/auth'
import {
  TicketApplyResponse,
  TicketDeclineBody,
  TicketResponse,
  TicketSubmitBody,
  TicketsResponse,
} from '../contract/plans'
import { profileGet } from '../services/lens'
import { studentsGet } from '../services/school'
import { iepApplyTicket, ticketsForStudent, ticketsGet, ticketsList, ticketsResolve, ticketsSubmit } from '../services/tickets'
import type { Kit } from './context'

const StatusQuery = z.object({ status: z.enum(['pending', 'all']).default('pending') })

/** IEP change tickets: the case manager files, the school administrator applies or declines. Nobody edits a confirmed IEP directly. */
export function ticketRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, req, deps } = kit

  app.post('/students/:id/tickets', signedIn, mw.requireCapability('ticket.submit'), async (c) => {
    const r = req(c)
    const studentId = r.param('id')
    const body = await r.body(TicketSubmitBody)
    const { student } = await r.school(studentsGet, { studentId })
    const profile = await r.student(studentId, profileGet, { displayToken: student.displayToken, grade: student.grade })
    const iepVersion = 'iepVersion' in profile ? profile.iepVersion : null
    if (iepVersion === null) throw new AltamyraError('bad_request', 'Import and confirm the IEP before filing a change ticket.')
    return r.json(TicketResponse, await r.school(ticketsSubmit, { studentId, iepVersion, ...body }), 201)
  })

  /** The case manager's tickets for one student (their outcome included), or all of them for the school administrator. */
  app.get('/students/:id/tickets', signedIn, async (c) => {
    const r = req(c)
    return r.json(TicketsResponse, await r.school(ticketsForStudent, { studentId: r.param('id'), schoolId: deps.schoolId(r.env) }))
  })

  app.get('/tickets', signedIn, async (c) => {
    const r = req(c)
    const { status } = r.query(StatusQuery, { status: c.req.query('status') })
    return r.json(TicketsResponse, await r.school(ticketsList, { schoolId: deps.schoolId(r.env), status }))
  })

  /** Creates IEP version N+1 with the change made, then closes the ticket as applied. */
  app.post('/tickets/:tid/apply', signedIn, async (c) => {
    const r = req(c)
    const schoolId = deps.schoolId(r.env)
    const { ticket } = await r.school(ticketsGet, { schoolId, ticketId: r.param('tid') })
    if (ticket.status !== 'pending') throw new AltamyraError('version_conflict', `This ticket is already ${ticket.status}.`)
    const { iepVersion } = await r.student(ticket.studentId, iepApplyTicket, {
      schoolId,
      ticketId: ticket.id,
      iepVersion: ticket.iepVersion,
      target: ticket.target,
      proposedChange: ticket.proposedChange,
    })
    const resolved = await r.school(ticketsResolve, { schoolId, ticketId: ticket.id, outcome: 'applied' })
    return r.json(TicketApplyResponse, { ticket: resolved.ticket, iepVersion })
  })

  app.post('/tickets/:tid/decline', signedIn, async (c) => {
    const r = req(c)
    const { reason } = await r.body(TicketDeclineBody)
    return r.json(TicketResponse, await r.school(ticketsResolve, { schoolId: deps.schoolId(r.env), ticketId: r.param('tid'), outcome: 'declined', reason }))
  })
}
