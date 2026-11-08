import { afterEach, describe, expect, it } from 'vitest'
import { SCHOOL, USER_IDS } from '../fixtures'
import { closeAll } from '../services/testing'
import { kai, sofia } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

const { teacher, ea, caseManager, parentKai, districtLead, schoolAdmin } = USER_IDS
const TODAY = '2026-11-09'
const text = 'Read the short text about salmon. Retell the main idea. Write two sentences about one stage.'

async function draftFor(h: ReturnType<typeof createHarness>, studentId = kai) {
  const res = await h.post(teacher, `/students/${studentId}/lesson-plans`, { title: 'Salmon', text })
  expect(res.status).toBe(201)
  return res.body.plan
}

describe('lesson plans', () => {
  it('teacher creates a draft, edits it, and approves it', async () => {
    const h = createHarness()
    const plan = await draftFor(h)
    expect(plan.status).toBe('draft')
    expect(plan.originalText).toBe(text)
    expect(plan.proposed.length).toBeGreaterThan(0)
    expect(plan.tailoredText).toContain('Changes for this student')

    const drop = { id: plan.proposed[0].id, accepted: false }
    const patched = await h.call(teacher, 'PATCH', `/lesson-plans/${plan.id}`, { studentId: kai, proposed: [drop], title: 'Salmon 2', version: plan.version })
    expect(patched.status).toBe(200)
    expect(patched.body.plan.proposed[0].accepted).toBe(false)
    expect(patched.body.plan.title).toBe('Salmon 2')
    expect(patched.body.plan.status).toBe('draft')

    const stale = await h.call(teacher, 'PATCH', `/lesson-plans/${plan.id}`, { studentId: kai, title: 'x', version: plan.version })
    expect(stale.status).toBe(409)

    const approved = await h.post(teacher, `/lesson-plans/${plan.id}/approve`, { studentId: kai, version: patched.body.plan.version })
    expect(approved.status).toBe(200)
    expect(approved.body.plan.status).toBe('approved')
    expect(approved.body.plan.approvedBy).toBe(teacher)
    const audits = h.school.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'lesson_plans.%'").map((a) => a.action)
    expect(audits).toEqual(['lesson_plans.create', 'lesson_plans.edit', 'lesson_plans.approve'])

    // Editing an approved plan sends it back to draft.
    const edited = await h.call(teacher, 'PATCH', `/lesson-plans/${plan.id}`, { studentId: kai, tailoredText: 'By hand', version: approved.body.plan.version })
    expect(edited.body.plan.status).toBe('draft')
  })

  it('teacher today lists drafts and students with no plan', async () => {
    const h = createHarness()
    await draftFor(h)
    const today = await h.get(teacher, '/lesson-plans/today')
    expect(today.status).toBe(200)
    expect(today.body.date).toBe(TODAY)
    const byId = Object.fromEntries(today.body.students.map((s: any) => [s.studentId, s.plan]))
    expect(byId[kai]).toMatchObject({ status: 'draft' })
    expect(byId[sofia]).toBeNull()
  })

  it('EA and case manager never see draft plan content', async () => {
    const h = createHarness()
    const plan = await draftFor(h)
    for (const user of [ea, caseManager]) {
      const today = await h.get(user, '/lesson-plans/today')
      expect(today.status).toBe(200)
      expect(today.body.students.find((s: any) => s.studentId === kai).plan).toBeNull()
      expect(JSON.stringify(today.body)).not.toContain(plan.title)
      const per = await h.get(user, `/students/${kai}/lesson-plans`)
      expect(per.status).toBe(200)
      expect(per.body.plans).toEqual([])
      expect(JSON.stringify(per.body)).not.toContain('salmon')
    }
    await h.post(teacher, `/lesson-plans/${plan.id}/approve`, { studentId: kai, version: plan.version })
    for (const user of [ea, caseManager]) {
      const per = await h.get(user, `/students/${kai}/lesson-plans`)
      expect(per.body.plans).toHaveLength(1)
      expect(per.body.plans[0].status).toBe('approved')
      const today = await h.get(user, '/lesson-plans/today')
      expect(today.body.students.find((s: any) => s.studentId === kai).plan).toMatchObject({ status: 'approved' })
    }
  })

  it('EA sees only assigned students and cannot write', async () => {
    const h = createHarness()
    const today = await h.get(ea, '/lesson-plans/today')
    expect(today.body.students.map((s: any) => s.studentId).sort()).toEqual([kai, sofia].sort())
    const plan = await draftFor(h)
    expect((await h.post(ea, `/students/${kai}/lesson-plans`, { title: 'x', text })).status).toBe(403)
    expect((await h.call(ea, 'PATCH', `/lesson-plans/${plan.id}`, { studentId: kai, title: 'x', version: 1 })).status).toBe(403)
    expect((await h.post(ea, `/lesson-plans/${plan.id}/approve`, { studentId: kai, version: 1 })).status).toBe(403)
    expect((await h.post(caseManager, `/students/${kai}/lesson-plans`, { title: 'x', text })).status).toBe(403)
  })

  it('parent, district lead and school admin get 403', async () => {
    const h = createHarness()
    for (const user of [parentKai, districtLead, schoolAdmin]) {
      expect((await h.get(user, '/lesson-plans/today')).status).toBe(403)
      expect((await h.get(user, `/students/${kai}/lesson-plans`)).status).toBe(403)
      expect((await h.post(user, `/students/${kai}/lesson-plans`, { title: 'x', text })).status).toBe(403)
    }
  })

  it('refuses a second plan for the same day and a plan id from another student', async () => {
    const h = createHarness()
    const plan = await draftFor(h)
    expect((await h.post(teacher, `/students/${kai}/lesson-plans`, { title: 'again', text })).status).toBe(409)
    const wrong = await h.call(teacher, 'PATCH', `/lesson-plans/${plan.id}`, { studentId: sofia, title: 'x', version: 1 })
    expect(wrong.status).toBe(404)
  })

  it('sends only de-identified text to the model', async () => {
    const h = createHarness()
    await draftFor(h)
    expect(h.aiCalls.lensForStudent).toBe(1)
    expect(JSON.stringify(h.aiRequests)).not.toMatch(/Kai|Nakamura/)
  })
})

const ticketBody = { target: 'accommodations', proposedChange: 'Extra time on written tasks.', reason: 'Fatigue in long writing blocks.' }

describe('IEP change tickets', () => {
  it('case manager files a pending ticket; teacher, EA and parent cannot', async () => {
    const h = createHarness()
    const res = await h.post(caseManager, `/students/${kai}/tickets`, ticketBody)
    expect(res.status).toBe(201)
    expect(res.body.ticket).toMatchObject({ status: 'pending', iepVersion: 1, submittedBy: caseManager })
    for (const user of [teacher, ea, parentKai, districtLead]) {
      expect((await h.post(user, `/students/${kai}/tickets`, ticketBody)).status).toBe(403)
      expect((await h.get(user, `/students/${kai}/tickets`)).status).toBe(403)
      expect((await h.get(user, '/tickets')).status).toBe(403)
    }
    const mine = await h.get(caseManager, `/students/${kai}/tickets`)
    expect(mine.body.tickets).toHaveLength(1)
    expect((await h.get(caseManager, '/tickets')).status).toBe(403)
  })

  it('school admin applies: IEP version goes up by exactly 1, with audit rows', async () => {
    const h = createHarness()
    const { ticket } = (await h.post(caseManager, `/students/${kai}/tickets`, ticketBody)).body
    const list = await h.get(schoolAdmin, '/tickets?status=pending')
    expect(list.body.tickets.map((t: any) => t.id)).toEqual([ticket.id])
    for (const user of [caseManager, teacher, ea, parentKai]) expect((await h.post(user, `/tickets/${ticket.id}/apply`)).status).toBe(403)

    const before = (await h.get(caseManager, `/students/${kai}`)).body
    const applied = await h.post(schoolAdmin, `/tickets/${ticket.id}/apply`)
    expect(applied.status).toBe(200)
    expect(applied.body.iepVersion).toBe(before.iepVersion + 1)
    expect(applied.body.ticket).toMatchObject({ status: 'applied', reviewedBy: schoolAdmin })

    const after = (await h.get(caseManager, `/students/${kai}`)).body
    expect(after.iepVersion).toBe(before.iepVersion + 1)
    expect(after.sections.accommodations).toContain(ticketBody.proposedChange)
    expect(after.goals.length).toBe(before.goals.length)
    expect(h.studentSql(kai).get("SELECT 1 AS x FROM audit_log WHERE action = 'iep_versions.ticket_apply'")).toBeTruthy()
    expect(h.school.get("SELECT 1 AS x FROM audit_log WHERE action = 'iep_change_tickets.apply'")).toBeTruthy()

    expect((await h.post(schoolAdmin, `/tickets/${ticket.id}/apply`)).status).toBe(409)
    expect((await h.get(caseManager, `/students/${kai}/tickets`)).body.tickets[0].status).toBe('applied')
  })

  it('decline keeps the IEP version and records the reason', async () => {
    const h = createHarness()
    const { ticket } = (await h.post(caseManager, `/students/${kai}/tickets`, ticketBody)).body
    const before = (await h.get(caseManager, `/students/${kai}`)).body.iepVersion
    expect((await h.post(teacher, `/tickets/${ticket.id}/decline`, { reason: 'x' })).status).toBe(403)
    const res = await h.post(schoolAdmin, `/tickets/${ticket.id}/decline`, { reason: 'Needs team review' })
    expect(res.status).toBe(200)
    expect(res.body.ticket).toMatchObject({ status: 'declined', declineReason: 'Needs team review' })
    expect((await h.get(caseManager, `/students/${kai}`)).body.iepVersion).toBe(before)
    expect((await h.get(schoolAdmin, '/tickets?status=pending')).body.tickets).toEqual([])
    expect((await h.get(schoolAdmin, '/tickets?status=all')).body.tickets).toHaveLength(1)
  })

  it('applying an unknown target fails and leaves the ticket pending', async () => {
    const h = createHarness()
    const { ticket } = (await h.post(caseManager, `/students/${kai}/tickets`, { ...ticketBody, target: 'nonsense' })).body
    expect((await h.post(schoolAdmin, `/tickets/${ticket.id}/apply`)).status).toBe(400)
    expect((await h.get(schoolAdmin, '/tickets')).body.tickets[0].status).toBe('pending')
  })

  it('replaces goal text when the target is a goal id', async () => {
    const h = createHarness()
    const profile = (await h.get(caseManager, `/students/${kai}`)).body
    const goal = profile.goals[0]
    const { ticket } = (await h.post(caseManager, `/students/${kai}/tickets`, { ...ticketBody, target: goal.id, proposedChange: 'Retell a short text with two supporting details.' })).body
    expect((await h.post(schoolAdmin, `/tickets/${ticket.id}/apply`)).status).toBe(200)
    const after = (await h.get(caseManager, `/students/${kai}`)).body
    expect(after.goals.find((g: any) => g.id === goal.id).text).toBe('Retell a short text with two supporting details.')
  })
})

describe('IEP import stays with the case manager', () => {
  it('teacher and EA get 403 on import, source-text, confirm and objective confirm', async () => {
    const h = createHarness()
    for (const user of [teacher, ea, schoolAdmin]) {
      expect((await h.post(user, `/students/${kai}/iep/import`, { sourceKind: 'text', text: 'x' })).status).toBe(403)
      expect((await h.post(user, `/students/${kai}/iep/source-text`, { sourceKind: 'text', text: 'x' })).status).toBe(403)
      expect((await h.post(user, `/students/${kai}/iep/2/confirm`, { expectedVersion: 1 })).status).toBe(403)
      expect((await h.post(user, `/objectives/abc/confirm?studentId=${kai}`, {})).status).toBe(403)
    }
  })
})

describe('school admin roles', () => {
  it('/me carries schoolId and the memberships list answers', async () => {
    const h = createHarness()
    for (const user of [schoolAdmin, teacher, ea, caseManager]) expect((await h.get(user, '/me')).body.schoolId).toBe(SCHOOL.id)
    const list = await h.get(schoolAdmin, `/admin/schools/${SCHOOL.id}/memberships`)
    expect(list.status).toBe(200)
    expect(list.body.memberships.length).toBeGreaterThan(0)
    expect((await h.get(teacher, `/admin/schools/${SCHOOL.id}/memberships`)).status).toBe(403)
  })
})

describe('dev seed', () => {
  it('seeds plans (one approved, one draft, one missing) and a pending ticket', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    const U = 'demo-user-1'
    h.clock.now = Date.now() // the demo seed is dated from the real clock
    expect((await h.post(U, '/dev/seed')).status).toBe(200)
    await h.post(U, '/dev/role', { role: 'teacher' })
    const today = await h.get(U, '/lesson-plans/today')
    expect(today.status).toBe(200)
    expect(today.body.students.map((s: any) => s.plan?.status ?? 'none').sort()).toEqual(['approved', 'draft', 'none'])
    await h.post(U, '/dev/role', { role: 'ea' })
    expect((await h.get(U, '/lesson-plans/today')).body.students.map((s: any) => s.plan?.status ?? 'none').sort()).toEqual(['approved', 'none'])
    await h.post(U, '/dev/role', { role: 'school_admin' })
    expect((await h.get(U, '/me')).body.schoolId).toBe(SCHOOL.id)
    expect((await h.get(U, '/tickets')).body.tickets).toHaveLength(1)
  })
})
