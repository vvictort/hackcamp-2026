import { z } from 'zod'
import { DateString, Id, RowVersion, Timestamp } from './common'
import { Label } from './enums'

/** Per-student lesson plans (original, proposed changes, tailored) and IEP change tickets. School room entities. */

export const PLAN_STATUSES = ['draft', 'approved'] as const
export const PlanStatus = z.enum(PLAN_STATUSES)
export type PlanStatus = z.infer<typeof PlanStatus>

/** One AI-proposed change; the teacher accepts or drops it before approving the tailored plan. */
export const ProposedChange = z.object({
  id: Id,
  text: z.string().min(1).max(4000),
  label: Label,
  accepted: z.boolean(),
})
export type ProposedChange = z.infer<typeof ProposedChange>

export const LessonPlan = z.object({
  id: Id,
  studentId: Id,
  lessonId: Id.nullable(),
  planDate: DateString,
  title: z.string().min(1).max(200),
  originalText: z.string().max(60_000),
  proposed: z.array(ProposedChange),
  tailoredText: z.string().max(60_000),
  status: PlanStatus,
  createdBy: Id,
  approvedBy: Id.nullable(),
  approvedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  version: RowVersion,
})
export type LessonPlan = z.infer<typeof LessonPlan>

/** What a reader gets; EA and case manager only ever get approved plans. */
export const LessonPlanView = z.object({
  id: Id,
  studentId: Id,
  date: DateString,
  title: z.string(),
  originalText: z.string(),
  proposed: z.array(ProposedChange),
  tailoredText: z.string(),
  status: PlanStatus,
  approvedBy: Id.nullable(),
  approvedAt: Timestamp.nullable(),
  version: RowVersion,
})
export type LessonPlanView = z.infer<typeof LessonPlanView>

export const PlansTodayResponse = z.object({
  date: DateString,
  students: z.array(
    z.object({
      studentId: Id,
      label: z.string(),
      plan: z.object({ id: Id, title: z.string(), status: PlanStatus }).nullable(),
    }),
  ),
})
export type PlansTodayResponse = z.infer<typeof PlansTodayResponse>

export const StudentPlansResponse = z.object({ plans: z.array(LessonPlanView) })

export const PlanCreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(60_000),
  date: DateString.optional(),
})
export type PlanCreateBody = z.infer<typeof PlanCreateBody>

export const PlanPatchBody = z.object({
  studentId: Id,
  title: z.string().trim().min(1).max(200).optional(),
  originalText: z.string().trim().min(1).max(60_000).optional(),
  proposed: z.array(z.object({ id: Id, accepted: z.boolean(), text: z.string().trim().min(1).max(4000).optional() })).optional(),
  tailoredText: z.string().max(60_000).optional(),
  version: RowVersion,
})
export type PlanPatchBody = z.infer<typeof PlanPatchBody>

export const PlanApproveBody = z.object({ studentId: Id, version: RowVersion })

// ---------- IEP change tickets ----------

export const TICKET_STATUSES = ['pending', 'applied', 'declined'] as const
export const TicketStatus = z.enum(TICKET_STATUSES)
export type TicketStatus = z.infer<typeof TicketStatus>

export const Ticket = z.object({
  id: Id,
  studentId: Id,
  iepVersion: z.number().int().min(1),
  target: z.string().trim().min(1).max(200),
  proposedChange: z.string().trim().min(1).max(4000),
  reason: z.string().trim().min(1).max(2000),
  status: TicketStatus,
  submittedBy: Id,
  reviewedBy: Id.nullable(),
  reviewedAt: Timestamp.nullable(),
  declineReason: z.string().nullable(),
  createdAt: Timestamp,
  version: RowVersion,
})
export type Ticket = z.infer<typeof Ticket>

export const TicketView = Ticket.extend({ studentLabel: z.string() })
export type TicketView = z.infer<typeof TicketView>

export const TicketSubmitBody = z.object({
  target: z.string().trim().min(1).max(200),
  proposedChange: z.string().trim().min(1).max(4000),
  reason: z.string().trim().min(1).max(2000),
})
export const TicketDeclineBody = z.object({ reason: z.string().trim().max(2000).optional() })
export const TicketsResponse = z.object({ tickets: z.array(TicketView) })
export const TicketApplyResponse = z.object({ ticket: TicketView, iepVersion: z.number().int().min(1) })
export const TicketResponse = z.object({ ticket: TicketView })
