import { describe, expect, it } from 'vitest'
import {
  ACTOR_ROLES,
  CAPABILITIES,
  NON_STUDENT_CAPABILITIES,
  PERMISSION_MATRIX,
  READ_CAPABILITIES,
  STUDENT_CAPABILITIES,
  can,
  userActor,
  type Actor,
  type ActorRole,
  type StudentCapability,
} from './permissions'

/**
 * Expectations are typed in from the role model (owner decision 2026-11-08),
 * not derived from PERMISSION_MATRIX, so drift in the code table fails here.
 *
 * Y = allowed; R = allowed only for reading (opts.access = 'read', or a view
 * capability); A = only where the IEP authorizes; O = only own entries; - = refused.
 */
type Expect = 'Y' | 'R' | 'A' | 'O' | '-'

const STUDENT = 'stu-1'
const OTHER = 'stu-2'

const actors: Record<ActorRole, Actor> = {
  case_manager: userActor('u-cm', { studentRoles: { [STUDENT]: ['case_manager'] } }),
  teacher: userActor('u-teacher', { studentRoles: { [STUDENT]: ['teacher'] }, classIds: ['class-1'] }),
  ea: userActor('u-ea', { studentRoles: { [STUDENT]: ['ea'] } }),
  parent: userActor('u-parent', { parentOf: [STUDENT] }),
  district_lead: userActor('u-dl', { districtLeadOf: ['district-1'] }),
  school_admin: userActor('u-admin', { schoolAdminOf: ['school-1'] }),
}

//                                 CM   Teacher EA   Parent DL   Admin
const MODEL: Record<StudentCapability, [Expect, Expect, Expect, Expect, Expect, Expect]> = {
  'iep.import':          ['Y', '-', '-', '-', '-', '-'],
  'objective.confirm':   ['Y', '-', '-', '-', '-', '-'],
  'iep.view':            ['Y', 'R', 'R', '-', '-', '-'],
  'ticket.submit':       ['Y', '-', '-', '-', '-', '-'],
  'lesson_plan.view':    ['R', 'Y', 'R', '-', '-', '-'],
  'lesson_plan.edit':    ['R', 'Y', 'R', '-', '-', '-'],
  'adaptation.approve':  ['-', 'Y', '-', '-', '-', '-'],
  'modification.apply':  ['-', 'A', '-', '-', '-', '-'],
  'evidence.capture':    ['-', 'Y', 'Y', '-', '-', '-'],
  'review.confirm':      ['-', 'O', 'O', '-', '-', '-'],
  'proficiency.set':     ['-', 'Y', '-', '-', '-', '-'],
  'summary.view':        ['R', 'Y', 'Y', 'R', '-', '-'],
  'summary.edit':        ['-', 'Y', 'Y', '-', '-', '-'],
  'summary.approve':     ['-', 'Y', 'Y', '-', '-', '-'],
  'summary.caseload':    ['R', '-', '-', '-', '-', '-'],
  'progress.view':       ['R', 'R', 'R', '-', '-', '-'],
  'consent.manage':      ['-', '-', '-', 'Y', '-', '-'],
}
const COLUMNS: ActorRole[] = ['case_manager', 'teacher', 'ea', 'parent', 'district_lead', 'school_admin']

describe('role model permission matrix (actor x capability)', () => {
  it('has exactly the six roles', () => {
    expect([...ACTOR_ROLES].sort()).toEqual(['case_manager', 'district_lead', 'ea', 'parent', 'school_admin', 'teacher'])
  })

  it('covers every student capability and includes the next-round names', () => {
    expect(Object.keys(MODEL).sort()).toEqual([...STUDENT_CAPABILITIES].sort())
    for (const name of ['ticket.submit', 'ticket.review', 'iep.import', 'lesson_plan.view', 'lesson_plan.edit', 'summary.view', 'summary.edit', 'summary.approve']) {
      expect(CAPABILITIES as readonly string[]).toContain(name)
    }
  })

  it('has no capability of a removed feature', () => {
    for (const gone of ['iep.write', 'iep.propose', 'objective.propose', 'draft.edit', 'parent_input.send', 'today_link.create', 'consent.record', 'family_summary.approve', 'lesson.augment']) {
      expect(CAPABILITIES as readonly string[]).not.toContain(gone)
    }
  })

  for (const capability of STUDENT_CAPABILITIES) {
    COLUMNS.forEach((role, i) => {
      const expected = MODEL[capability][i]
      it(`${role} / ${capability} = ${expected}`, () => {
        const actor = actors[role]
        const write = can(actor, capability, STUDENT)
        const readOnly = can(actor, capability, STUDENT, { access: 'read' })
        switch (expected) {
          case 'Y':
            expect(write.allowed).toBe(true)
            break
          case 'R':
            expect(readOnly.allowed).toBe(true)
            expect(write.allowed).toBe(READ_CAPABILITIES.includes(capability))
            if (!READ_CAPABILITIES.includes(capability)) expect(write.reason).toBe('read_only')
            break
          case 'A':
            expect(write.allowed).toBe(false)
            expect(can(actor, capability, STUDENT, { subject: 'math', modificationSubjects: ['math'] }).allowed).toBe(true)
            expect(can(actor, capability, STUDENT, { subject: 'literacy', modificationSubjects: ['math'] }).allowed).toBe(false)
            break
          case 'O':
            expect(write.allowed).toBe(false)
            expect(can(actor, capability, STUDENT, { recordedBy: actor.userId }).allowed).toBe(true)
            expect(can(actor, capability, STUDENT, { recordedBy: 'someone-else' }).allowed).toBe(false)
            break
          case '-':
            expect(write.allowed).toBe(false)
            expect(readOnly.allowed).toBe(false)
            break
        }
      })
    })
  }

  it('code table agrees with the model on which cells exist', () => {
    for (const capability of STUDENT_CAPABILITIES) {
      COLUMNS.forEach((role, i) => {
        expect(PERMISSION_MATRIX[capability][role] !== undefined).toBe(MODEL[capability][i] !== '-')
      })
    }
  })
})

describe('approved-only visibility of AI content', () => {
  it('EA, case manager and parent see approved content only; the teacher sees drafts too', () => {
    expect(can(actors.ea, 'lesson_plan.view', STUDENT)).toMatchObject({ allowed: true, filter: 'approved_only' })
    expect(can(actors.case_manager, 'lesson_plan.view', STUDENT)).toMatchObject({ allowed: true, filter: 'approved_only' })
    expect(can(actors.case_manager, 'summary.view', STUDENT)).toMatchObject({ allowed: true, filter: 'approved_only' })
    expect(can(actors.parent, 'summary.view', STUDENT)).toMatchObject({ allowed: true, filter: 'approved_only' })
    expect(can(actors.teacher, 'lesson_plan.view', STUDENT)).toMatchObject({ allowed: true, filter: 'all' })
    expect(can(actors.ea, 'summary.view', STUDENT)).toMatchObject({ allowed: true, filter: 'all' })
  })

  it('only the EA and the teacher edit or approve summaries', () => {
    for (const cap of ['summary.edit', 'summary.approve'] as const) {
      for (const role of ['case_manager', 'parent', 'district_lead', 'school_admin'] as const) {
        expect(can(actors[role], cap, STUDENT).allowed, `${role} ${cap}`).toBe(false)
      }
      expect(can(actors.ea, cap, STUDENT).allowed).toBe(true)
      expect(can(actors.teacher, cap, STUDENT).allowed).toBe(true)
    }
  })
})

describe('case manager has no direct edit rights', () => {
  it('cannot capture, review, edit lessons or summaries', () => {
    for (const cap of ['evidence.capture', 'review.confirm', 'summary.edit', 'summary.approve', 'adaptation.approve', 'consent.manage'] as const) {
      expect(can(actors.case_manager, cap, STUDENT, { recordedBy: 'u-cm' }).allowed, cap).toBe(false)
    }
    expect(can(actors.case_manager, 'lesson_plan.edit', STUDENT).allowed).toBe(false)
  })

  it('cannot import for a student outside the caseload', () => {
    expect(can(actors.case_manager, 'iep.import', OTHER)).toMatchObject({ allowed: false, reason: 'not_in_scope' })
  })
})

describe('scope rules', () => {
  it('nobody reaches a student outside their scope', () => {
    for (const role of COLUMNS) {
      for (const capability of STUDENT_CAPABILITIES) {
        const r = can(actors[role], capability, OTHER, {
          access: 'read',
          subject: 'math',
          modificationSubjects: ['math'],
          recordedBy: actors[role].userId,
        })
        expect(r.allowed, `${role} ${capability}`).toBe(false)
      }
    }
  })

  it('an EA is scoped to assigned students and cannot approve adaptations', () => {
    expect(can(actors.ea, 'iep.view', STUDENT)).toMatchObject({ allowed: true, filter: 'all' })
    expect(can(actors.ea, 'iep.view', OTHER).allowed).toBe(false)
    expect(can(actors.ea, 'adaptation.approve', STUDENT).allowed).toBe(false)
  })

  it('a parent reaches the monthly summary and consent for their own child only', () => {
    expect(can(actors.parent, 'summary.view', STUDENT).allowed).toBe(true)
    expect(can(actors.parent, 'consent.manage', STUDENT).allowed).toBe(true)
    expect(can(actors.parent, 'summary.view', OTHER).allowed).toBe(false)
    for (const cap of STUDENT_CAPABILITIES.filter((c) => c !== 'summary.view' && c !== 'consent.manage')) {
      expect(can(actors.parent, cap, STUDENT, { access: 'read' }).allowed, cap).toBe(false)
    }
  })

  it('district lead has no student access, only insights for their district', () => {
    for (const capability of STUDENT_CAPABILITIES) {
      expect(can(actors.district_lead, capability, STUDENT, { access: 'read' }).allowed).toBe(false)
    }
    expect(can(actors.district_lead, 'insights.view', null, { districtId: 'district-1' }).allowed).toBe(true)
    expect(can(actors.district_lead, 'insights.view', null, { districtId: 'district-2' }).allowed).toBe(false)
    expect(can(actors.teacher, 'insights.view', null, { districtId: 'district-1' }).allowed).toBe(false)
  })

  it('school admin manages memberships and tickets of their school only and has no student access', () => {
    for (const cap of ['membership.manage', 'ticket.review'] as const) {
      expect(NON_STUDENT_CAPABILITIES).toContain(cap)
      expect(can(actors.school_admin, cap, null, { schoolId: 'school-1' }).allowed).toBe(true)
      expect(can(actors.school_admin, cap, null, { schoolId: 'school-2' }).allowed).toBe(false)
      expect(can(actors.case_manager, cap, null, { schoolId: 'school-1' }).allowed).toBe(false)
    }
    expect(can(actors.school_admin, 'iep.view', STUDENT).allowed).toBe(false)
  })

  it('a missing studentId is refused for student capabilities', () => {
    expect(can(actors.case_manager, 'iep.view', undefined)).toMatchObject({ allowed: false, reason: 'student_required' })
  })

  it('roles are per student: one user can be teacher for one student and case manager for another', () => {
    const both = userActor('u-both', { studentRoles: { [STUDENT]: ['teacher'], [OTHER]: ['case_manager'] } })
    expect(can(both, 'iep.import', STUDENT).allowed).toBe(false)
    expect(can(both, 'iep.import', OTHER).allowed).toBe(true)
  })

  it('modification needs both a subject and IEP authorization', () => {
    expect(can(actors.teacher, 'modification.apply', STUDENT, { modificationSubjects: ['math'] }).allowed).toBe(false)
    expect(can(actors.teacher, 'modification.apply', STUDENT, { subject: 'Math ', modificationSubjects: ['math'] }).allowed).toBe(true)
  })

  it('lists every capability in the matrix', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...CAPABILITIES].sort())
  })
})
