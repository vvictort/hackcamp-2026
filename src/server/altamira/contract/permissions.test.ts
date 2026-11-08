import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  PERMISSION_MATRIX,
  STUDENT_CAPABILITIES,
  can,
  sessionActor,
  userActor,
  type Actor,
  type ActorRole,
  type StudentCapability,
} from './permissions'

/**
 * M0 gate. Expectations are typed in straight from the PRD permission matrix,
 * not derived from PERMISSION_MATRIX, so a change to the code table that
 * drifts from the PRD fails here.
 *
 * Y = allowed; R = allowed only for reading (opts.access = 'read', or a view
 * capability); P = refused, must propose/send input instead; A = only where the
 * IEP authorizes; O = only own entries; - = refused.
 */
type Expect = 'Y' | 'R' | 'P' | 'A' | 'O' | '-'

const STUDENT = 'stu-1'
const OTHER = 'stu-2'
const SOON = '2099-01-01T00:00:00.000Z'

const actors: Record<ActorRole, Actor> = {
  case_manager: userActor('u-cm', { studentRoles: { [STUDENT]: ['case_manager'] } }),
  teacher: userActor('u-teacher', { studentRoles: { [STUDENT]: ['teacher'] }, classIds: ['class-1'] }),
  ea: userActor('u-ea', { studentRoles: { [STUDENT]: ['ea'] } }),
  student_session: sessionActor({ kind: 'student_session', studentId: STUDENT, tokenId: 't1', expiresAt: SOON, startedBy: 'u-ea' }),
  parent: userActor('u-parent', { parentOf: [STUDENT] }),
  substitute_link: sessionActor({ kind: 'substitute_link', studentId: STUDENT, tokenId: 't2', expiresAt: SOON, startedBy: null }),
  district_lead: userActor('u-dl', { districtLeadOf: ['district-1'] }),
  school_admin: userActor('u-admin', { schoolAdminOf: ['school-1'] }),
}

//                                 CM   Teacher EA   Student Parent Sub  DL   Admin
const PRD: Record<StudentCapability, [Expect, Expect, Expect, Expect, Expect, Expect, Expect, Expect]> = {
  'iep.write':              ['Y', 'P', '-', '-', 'P', '-', '-', '-'],
  'iep.propose':            ['-', 'Y', '-', '-', '-', '-', '-', '-'],
  'parent_input.send':      ['-', '-', '-', '-', 'Y', '-', '-', '-'],
  'objective.confirm':      ['Y', 'P', '-', '-', '-', '-', '-', '-'],
  'objective.propose':      ['-', 'Y', '-', '-', '-', '-', '-', '-'],
  'iep.view':               ['Y', 'Y', 'R', 'R', 'R', 'R', '-', '-'],
  'lesson.augment':         ['Y', 'Y', 'R', 'R', 'R', '-', '-', '-'],
  'adaptation.approve':     ['Y', 'Y', 'R', 'R', 'R', '-', '-', '-'],
  'modification.apply':     ['A', 'A', '-', '-', '-', '-', '-', '-'],
  'evidence.capture':       ['Y', 'Y', 'Y', 'Y', '-', '-', '-', '-'],
  'review.confirm':         ['Y', 'Y', 'O', '-', '-', '-', '-', '-'],
  'proficiency.set':        ['Y', 'Y', '-', '-', '-', '-', '-', '-'],
  'draft.edit':             ['Y', 'Y', '-', '-', '-', '-', '-', '-'],
  'family_summary.approve': ['Y', 'Y', '-', '-', '-', '-', '-', '-'],
  'progress.view':          ['Y', 'Y', 'R', 'R', 'R', '-', '-', '-'],
  'consent.manage':         ['P', '-', '-', '-', 'Y', '-', '-', '-'],
  'consent.record':         ['Y', '-', '-', '-', '-', '-', '-', '-'],
  'today_link.create':      ['Y', 'Y', '-', '-', '-', '-', '-', '-'],
}
const COLUMNS: ActorRole[] = ['case_manager', 'teacher', 'ea', 'student_session', 'parent', 'substitute_link', 'district_lead', 'school_admin']

const VIEW_CAPS = new Set(['iep.view', 'progress.view'])

describe('PRD permission matrix (actor x capability)', () => {
  it('covers every student capability', () => {
    expect(Object.keys(PRD).sort()).toEqual([...STUDENT_CAPABILITIES].sort())
  })

  for (const capability of STUDENT_CAPABILITIES) {
    COLUMNS.forEach((role, i) => {
      const expected = PRD[capability][i]
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
            expect(write.allowed).toBe(VIEW_CAPS.has(capability))
            if (!VIEW_CAPS.has(capability)) expect(write.reason).toBe('read_only')
            break
          case 'P':
            expect(write.allowed).toBe(false)
            expect(write.reason).toBe('propose_only')
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

  it('code table agrees with the PRD table on which cells exist', () => {
    for (const capability of STUDENT_CAPABILITIES) {
      COLUMNS.forEach((role, i) => {
        expect(PERMISSION_MATRIX[capability][role] !== undefined).toBe(PRD[capability][i] !== '-')
      })
    }
  })
})

describe('PRD: every non-case-manager write to IEP or profile is refused', () => {
  const ieps = ['iep.write', 'objective.confirm'] as const
  for (const role of COLUMNS.filter((r) => r !== 'case_manager')) {
    for (const capability of ieps) {
      it(`${role} cannot ${capability}`, () => {
        const actor = actors[role]
        expect(can(actor, capability, STUDENT).allowed).toBe(false)
        expect(can(actor, capability, STUDENT, { access: 'read' }).allowed).toBe(false)
        expect(can(actor, capability, STUDENT, { access: 'write' }).allowed).toBe(false)
      })
    }
  }

  it('a case manager cannot write the IEP of a student outside their caseload', () => {
    expect(can(actors.case_manager, 'iep.write', OTHER)).toMatchObject({ allowed: false, reason: 'not_in_scope' })
  })

  it('teacher write is redirected to a proposal', () => {
    expect(can(actors.teacher, 'iep.write', STUDENT)).toMatchObject({ reason: 'propose_only', via: 'iep.propose' })
    expect(can(actors.teacher, 'objective.confirm', STUDENT)).toMatchObject({ reason: 'propose_only', via: 'objective.propose' })
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

  it('EA sees only assigned students and supports, today', () => {
    expect(can(actors.ea, 'iep.view', STUDENT)).toMatchObject({ allowed: true, filter: 'supports_only' })
    expect(can(actors.ea, 'progress.view', STUDENT)).toMatchObject({ allowed: true, filter: 'today' })
    expect(can(actors.ea, 'adaptation.approve', STUDENT).allowed).toBe(false)
  })

  it('parent sees only own child and only confirmed progress', () => {
    expect(can(actors.parent, 'progress.view', STUDENT)).toMatchObject({ allowed: true, filter: 'confirmed_only' })
    expect(can(actors.parent, 'progress.view', OTHER).allowed).toBe(false)
  })

  it('student session reaches only its student and never sees IEP text', () => {
    expect(can(actors.student_session, 'iep.view', STUDENT)).toMatchObject({ allowed: true, filter: 'supports_applied' })
    expect(can(actors.student_session, 'progress.view', STUDENT)).toMatchObject({ filter: 'self_simplified' })
    expect(can(actors.student_session, 'evidence.capture', OTHER).allowed).toBe(false)
  })

  it('session principals ignore any staff roles attached to them', () => {
    const forged: Actor = { ...actors.student_session, studentRoles: { [STUDENT]: ['case_manager'] } }
    expect(can(forged, 'iep.write', STUDENT).allowed).toBe(false)
  })

  it('substitute link works only for its student until expiry', () => {
    const now = Date.parse('2026-11-07T12:00:00.000Z')
    const link = sessionActor({
      kind: 'substitute_link',
      studentId: STUDENT,
      tokenId: 't3',
      expiresAt: '2026-11-07T15:00:00.000Z',
      startedBy: null,
    })
    expect(can(link, 'iep.view', STUDENT, { now })).toMatchObject({ allowed: true, filter: 'today_view' })
    expect(can(link, 'iep.view', STUDENT, { now: Date.parse('2026-11-07T15:00:00.000Z') })).toMatchObject({
      allowed: false,
      reason: 'expired',
    })
    expect(can(link, 'progress.view', STUDENT, { now }).allowed).toBe(false)
    expect(can(link, 'iep.view', OTHER, { now }).allowed).toBe(false)
  })

  it('district lead has no student access, only insights for their district', () => {
    for (const capability of STUDENT_CAPABILITIES) {
      expect(can(actors.district_lead, capability, STUDENT, { access: 'read' }).allowed).toBe(false)
    }
    expect(can(actors.district_lead, 'insights.view', null, { districtId: 'district-1' }).allowed).toBe(true)
    expect(can(actors.district_lead, 'insights.view', null, { districtId: 'district-2' }).allowed).toBe(false)
    expect(can(actors.teacher, 'insights.view', null, { districtId: 'district-1' }).allowed).toBe(false)
  })

  it('school admin manages memberships of their school only and has no student access', () => {
    expect(can(actors.school_admin, 'membership.manage', null, { schoolId: 'school-1' }).allowed).toBe(true)
    expect(can(actors.school_admin, 'membership.manage', null, { schoolId: 'school-2' }).allowed).toBe(false)
    expect(can(actors.case_manager, 'membership.manage', null, { schoolId: 'school-1' }).allowed).toBe(false)
    expect(can(actors.school_admin, 'iep.view', STUDENT).allowed).toBe(false)
  })

  it('a missing studentId is refused for student capabilities', () => {
    expect(can(actors.case_manager, 'iep.view', undefined)).toMatchObject({ allowed: false, reason: 'student_required' })
  })

  it('roles are per student: one user can be teacher for one student and case manager for another', () => {
    const both = userActor('u-both', { studentRoles: { [STUDENT]: ['teacher'], [OTHER]: ['case_manager'] } })
    expect(can(both, 'iep.write', STUDENT).allowed).toBe(false)
    expect(can(both, 'iep.write', OTHER).allowed).toBe(true)
  })

  it('modification needs both a subject and IEP authorization', () => {
    expect(can(actors.teacher, 'modification.apply', STUDENT, { modificationSubjects: ['math'] }).allowed).toBe(false)
    expect(can(actors.teacher, 'modification.apply', STUDENT, { subject: 'Math ', modificationSubjects: ['math'] }).allowed).toBe(true)
  })

  it('lists every capability in the matrix', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...CAPABILITIES].sort())
  })
})
