import { afterEach, describe, expect, it } from 'vitest'
import { AltamiraError } from '../contract/errors'
import { createHarness } from '../e2e/harness'
import { kai } from '../e2e/flows'
import { CBIEP_SAMPLE_TEXT, USER_IDS } from '../fixtures'
import { closeAll } from '../services/testing'
import { aiFailureResponse, parseCbIepText } from './cbiep'

afterEach(closeAll)
const { caseManager, teacher, ea, parentKai, districtLead, schoolAdmin } = USER_IDS
const importBody = { sourceKind: 'text', text: CBIEP_SAMPLE_TEXT }

describe('aiFailureResponse', () => {
  it('turns a provider failure into a clean 502 without details', async () => {
    const res = aiFailureResponse(new Error('fetch failed: https://x?key=SECRET'))
    expect(res?.status).toBe(502)
    const body = (await res!.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ai_unavailable')
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })
  it('leaves contract errors to the normal handler', () => {
    expect(aiFailureResponse(new AltamiraError('bad_request', 'x'))).toBeNull()
  })
})

describe('parseCbIepText', () => {
  it('reads the sample offline and rejects text without a name', () => {
    expect(parseCbIepText(CBIEP_SAMPLE_TEXT).goals.length).toBeGreaterThan(0)
    expect(() => parseCbIepText('nothing useful')).toThrow()
  })
})

describe('IEP import route', () => {
  it('refuses every role except the case manager', async () => {
    const h = createHarness()
    for (const user of [teacher, ea, parentKai, districtLead, schoolAdmin]) {
      expect((await h.post(user, `/students/${kai}/iep/import`, importBody)).status).toBe(403)
    }
    expect((await h.get(caseManager, `/students/${kai}`)).body.iepVersion).toBe(1)
  })

  it('keeps imported objectives unconfirmed until the case manager ticks them', async () => {
    const h = createHarness()
    const imp = await h.post(caseManager, `/students/${kai}/iep/import`, importBody)
    expect(imp.status).toBe(200)
    expect(imp.body.iep.confirmedAt).toBeNull()
    const goalIds = new Set(imp.body.goals.map((g: { id: string }) => g.id))
    // Pending version: the profile still shows the confirmed one.
    expect((await h.get(caseManager, `/students/${kai}`)).body.iepVersion).toBe(1)

    const confirmed = await h.post(caseManager, `/students/${kai}/iep/2/confirm`, { expectedVersion: imp.body.iep.rowVersion })
    expect(confirmed.status).toBe(200)
    const mine = (await h.get(caseManager, `/students/${kai}/objectives`)).body.objectives.filter((o: { goalId: string }) => goalIds.has(o.goalId))
    expect(mine.length).toBeGreaterThan(1)
    expect(mine.every((o: { status: string }) => o.status !== 'confirmed')).toBe(true)

    // Confirm one with an edit; the others stay unconfirmed.
    const [first, ...rest] = mine
    const ok = await h.post(caseManager, `/objectives/${first.id}/confirm?studentId=${kai}`, { expectedVersion: first.version, edits: { target: 9 } })
    expect(ok.status).toBe(200)
    expect(ok.body.objective).toMatchObject({ status: 'confirmed', target: 9 })
    const after = (await h.get(caseManager, `/students/${kai}/objectives`)).body.objectives
    for (const o of rest) expect(after.find((x: { id: string }) => x.id === o.id).status).not.toBe('confirmed')
    // The teacher and EA read the IEP but cannot confirm objectives.
    for (const user of [teacher, ea]) {
      expect((await h.get(user, `/students/${kai}`)).status).toBe(200)
      expect((await h.post(user, `/objectives/${rest[0].id}/confirm?studentId=${kai}`, { expectedVersion: 1 })).status).toBe(403)
    }
  })

  it('does not replace the current IEP until the case manager saves the pending one', async () => {
    const h = createHarness()
    const before = (await h.get(caseManager, `/students/${kai}`)).body
    await h.post(caseManager, `/students/${kai}/iep/import`, importBody)
    const during = (await h.get(caseManager, `/students/${kai}`)).body
    expect(during.iepVersion).toBe(before.iepVersion)
    expect(during.sections).toEqual(before.sections)
  })
})

describe('ticket apply audit', () => {
  it('writes before and after versions and the ticket id', async () => {
    const h = createHarness()
    const body = { target: 'goal:ignored', proposedChange: 'x', reason: 'y' }
    const goal = (await h.get(caseManager, `/students/${kai}`)).body.goals[0]
    const { ticket } = (await h.post(caseManager, `/students/${kai}/tickets`, { ...body, target: `goal:${goal.id}`, proposedChange: 'Read a short text and retell it.' })).body
    const res = await h.post(schoolAdmin, `/tickets/${ticket.id}/apply`)
    expect(res.status).toBe(200)
    const row = h.studentSql(kai).get<{ actor_id: string; before_json: string; after_json: string }>("SELECT * FROM audit_log WHERE action = 'iep_versions.ticket_apply'")
    expect(row?.actor_id).toBe(schoolAdmin)
    expect(JSON.parse(row!.before_json)).toEqual({ version: 1 })
    expect(JSON.parse(row!.after_json)).toMatchObject({ version: 2, ticketId: ticket.id, target: goal.id })
    const tr = h.school.get<{ actor_id: string; after_json: string }>("SELECT * FROM audit_log WHERE action = 'iep_change_tickets.apply'")
    expect(tr?.actor_id).toBe(schoolAdmin)
    expect(JSON.parse(tr!.after_json).status).toBe('applied')
    expect((await h.get(caseManager, `/students/${kai}`)).body.goals.find((g: { id: string }) => g.id === goal.id).text).toBe('Read a short text and retell it.')
  })
})

// Gap: the import route still creates a pending version over an existing IEP (needs a guard in
// routes/students.ts or services/measurement.ts iepImport, outside this task's write scope).
it.todo('import over an existing IEP is refused with a pointer to the ticket flow')
