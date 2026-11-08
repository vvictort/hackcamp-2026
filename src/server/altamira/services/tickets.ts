import { z } from 'zod'
import { Id } from '../contract/common'
import { AltamiraError } from '../contract/errors'
import { defineOp } from '../contract/ops'
import { can, type Actor } from '../contract/permissions'
import { Ticket, type TicketView } from '../contract/plans'
import type { IepSections } from '../contract/student'
import type { SqlExecutor } from '../db/sql'
import { audit, insertEntity, newId, nowIso, updateVersioned } from '../repos/base'
import { goalsForVersion, latestIep, objectiveById } from '../repos/iep'
import * as repo from '../repos/school'
import { Now, StudentArgs, authorize } from './authz'
import { requireCurrentIep } from './student-common'

/**
 * IEP change tickets. The case manager files one (no direct IEP edit); the school administrator applies or declines it.
 * Tickets live in the school room; applying creates IEP version N+1 in the student room (route orchestrates both).
 */

const SchoolArg = z.object({ schoolId: Id })

function viewOf(sql: SqlExecutor, t: Ticket): TicketView {
  return { ...t, studentLabel: repo.studentById(sql, t.studentId)?.displayToken ?? 'Unknown student' }
}

function requireTicket(sql: SqlExecutor, id: string): Ticket {
  const t = repo.ticketById(sql, id)
  if (!t) throw new AltamiraError('not_found', `ticket ${id} not found`)
  return t
}

export const ticketsSubmit = defineOp({
  name: 'tickets.submit',
  room: 'school',
  capability: 'ticket.submit',
  args: StudentArgs.extend({
    iepVersion: z.number().int().min(1),
    target: z.string().min(1).max(200),
    proposedChange: z.string().min(1).max(4000),
    reason: z.string().min(1).max(2000),
  }).extend(Now.shape),
  run(sql, args, actor): { ticket: TicketView } {
    authorize(actor, 'ticket.submit', args.studentId)
    if (!repo.studentById(sql, args.studentId)) throw new AltamiraError('not_found', `student ${args.studentId} not found`)
    const at = nowIso(args.now)
    const ticket: Ticket = {
      id: newId(),
      studentId: args.studentId,
      iepVersion: args.iepVersion,
      target: args.target,
      proposedChange: args.proposedChange,
      reason: args.reason,
      status: 'pending',
      submittedBy: actor.userId,
      reviewedBy: null,
      reviewedAt: null,
      declineReason: null,
      createdAt: at,
      version: 1,
    }
    insertEntity(sql, 'iep_change_tickets', ticket)
    audit(sql, actor, 'iep_change_tickets.submit', 'iep_change_tickets', ticket.id, undefined, ticket, at)
    return { ticket: viewOf(sql, ticket) }
  },
})

/** The case manager sees the tickets of their student; the school administrator sees them too. */
export const ticketsForStudent = defineOp({
  name: 'tickets.forStudent',
  room: 'school',
  args: StudentArgs.extend(SchoolArg.shape),
  run(sql, args, actor): { tickets: TicketView[] } {
    const admin = can(actor, 'ticket.review', null, { schoolId: args.schoolId }).allowed
    if (!admin) authorize(actor, 'ticket.submit', args.studentId)
    return { tickets: repo.ticketsForStudent(sql, args.studentId).map((t) => viewOf(sql, t)) }
  },
})

export const ticketsList = defineOp({
  name: 'tickets.list',
  room: 'school',
  capability: 'ticket.review',
  args: SchoolArg.extend({ status: z.enum(['pending', 'all']) }),
  run(sql, args, actor): { tickets: TicketView[] } {
    authorize(actor, 'ticket.review', null, { schoolId: args.schoolId })
    return { tickets: repo.ticketsByStatus(sql, args.status).map((t) => viewOf(sql, t)) }
  },
})

export const ticketsGet = defineOp({
  name: 'tickets.get',
  room: 'school',
  capability: 'ticket.review',
  args: SchoolArg.extend({ ticketId: Id }),
  run(sql, args, actor): { ticket: Ticket } {
    authorize(actor, 'ticket.review', null, { schoolId: args.schoolId })
    return { ticket: requireTicket(sql, args.ticketId) }
  },
})

/** Closes a pending ticket as applied or declined. The apply route runs this after the IEP version exists. */
export const ticketsResolve = defineOp({
  name: 'tickets.resolve',
  room: 'school',
  capability: 'ticket.review',
  args: SchoolArg.extend({ ticketId: Id, outcome: z.enum(['applied', 'declined']), reason: z.string().optional() }).extend(Now.shape),
  run(sql, args, actor): { ticket: TicketView } {
    authorize(actor, 'ticket.review', null, { schoolId: args.schoolId })
    const before = requireTicket(sql, args.ticketId)
    if (before.status !== 'pending') throw new AltamiraError('version_conflict', `ticket is already ${before.status}`)
    const at = nowIso(args.now)
    const declineReason = args.outcome === 'declined' ? (args.reason?.trim() || null) : null
    updateVersioned(sql, 'iep_change_tickets', before.id, before.version, {
      status: args.outcome,
      reviewed_by: actor.userId,
      reviewed_at: at,
      decline_reason: declineReason,
    })
    const ticket: Ticket = { ...before, status: args.outcome, reviewedBy: actor.userId, reviewedAt: at, declineReason, version: before.version + 1 }
    audit(sql, actor, `iep_change_tickets.${args.outcome === 'applied' ? 'apply' : 'decline'}`, 'iep_change_tickets', ticket.id, { status: 'pending' }, { status: ticket.status, declineReason }, at)
    return { ticket: viewOf(sql, ticket) }
  },
})

// ---------- student room: IEP version N+1 ----------

const LIST_SECTIONS = ['accommodations', 'supports', 'strengths', 'interests'] as const

function addToSection(sections: IepSections, target: string, text: string): IepSections | null {
  switch (target) {
    case 'accommodations':
    case 'supports':
      return { ...sections, [target]: [...sections[target], text] }
    case 'strengths':
    case 'interests':
      return { ...sections, profile: { ...sections.profile, [target]: [...sections.profile[target], text] } }
    default:
      return null
  }
}

/**
 * School administrator applies a ticket: the current IEP is copied as version N+1 with the change made, and confirmed.
 * Target is a section (accommodations, supports, strengths, interests, goals) or the id of a goal or objective (its goal text is replaced).
 * Goals still active move to the new version, so objectives and evidence stay attached.
 */
export const iepApplyTicket = defineOp({
  name: 'iep.applyTicket',
  room: 'student',
  capability: 'ticket.review',
  args: StudentArgs.extend(SchoolArg.shape)
    .extend({ ticketId: Id, iepVersion: z.number().int().min(1), target: z.string().min(1), proposedChange: z.string().min(1) })
    .extend(Now.shape),
  run(sql, args, actor: Actor): { iepVersion: number } {
    authorize(actor, 'ticket.review', null, { schoolId: args.schoolId })
    const current = requireCurrentIep(sql)
    if (current.version !== args.iepVersion) {
      throw new AltamiraError('version_conflict', `The IEP is now version ${current.version}; this ticket was written against version ${args.iepVersion}. Decline it and ask for a new ticket.`)
    }
    const at = nowIso(args.now)
    const goals = goalsForVersion(sql, current.version)
    let sections = addToSection(current.sections, args.target, args.proposedChange)
    let newGoalText: string | null = null
    let replacedGoalId: string | null = null
    if (!sections && args.target === 'goals') {
      newGoalText = args.proposedChange
      sections = { ...current.sections, goals: [...current.sections.goals, { area: 'Added by change ticket', text: args.proposedChange }] }
    } else if (!sections) {
      const goalId = goals.find((g) => g.id === args.target)?.id ?? objectiveById(sql, args.target)?.goalId
      const index = goals.findIndex((g) => g.id === goalId)
      if (!goalId || index < 0 || !current.sections.goals[index]) {
        throw new AltamiraError('bad_request', `Unknown ticket target "${args.target}". Use ${[...LIST_SECTIONS, 'goals'].join(', ')} or a goal or objective id.`)
      }
      replacedGoalId = goalId
      sections = { ...current.sections, goals: current.sections.goals.map((g, i) => (i === index ? { ...g, text: args.proposedChange } : g)) }
    }

    const version = (latestIep(sql)?.version ?? current.version) + 1
    const iep = {
      id: newId(),
      version,
      sections,
      modificationSubjects: current.modificationSubjects,
      sourceFileKey: null,
      importedBy: actor.userId,
      importedAt: at,
      confirmedBy: actor.userId,
      confirmedAt: at,
      rowVersion: 1,
    }
    insertEntity(sql, 'iep_versions', iep)
    // Active goals carry over to the new version; goals that were closed stay with their old version.
    sql.run("UPDATE goals SET iep_version = ?, version = version + 1 WHERE iep_version = ? AND status = 'active'", version, current.version)
    if (replacedGoalId) sql.run('UPDATE goals SET text = ? WHERE id = ?', args.proposedChange, replacedGoalId)
    if (newGoalText) {
      insertEntity(sql, 'goals', { id: newId(), iepVersion: version, area: 'Added by change ticket', text: newGoalText, status: 'active', version: 1 })
    }
    audit(
      sql,
      actor,
      'iep_versions.ticket_apply',
      'iep_versions',
      iep.id,
      { version: current.version },
      { version, ticketId: args.ticketId, target: args.target, change: args.proposedChange },
      at,
    )
    return { iepVersion: version }
  },
})

export const ticketSchoolOps = [ticketsSubmit, ticketsForStudent, ticketsList, ticketsGet, ticketsResolve]
export const ticketStudentOps = [iepApplyTicket]
