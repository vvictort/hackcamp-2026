import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { amara, kai, sofia, U } from './flows'
import { createHarness, type Harness } from './harness'

afterEach(closeAll)

/** Inserts an AI-written summary draft the way the next-round generator will: as a draft, not yet approved. */
function insertDraftSummary(h: Harness, studentId: string, id = 'f5000000-0000-4000-8000-000000000001') {
  h.studentSql(studentId).run(
    "INSERT INTO family_summaries (id, language, text, status, created_at, version) VALUES (?, 'en', 'A fictional monthly summary.', 'draft', '2026-11-09T17:00:00.000Z', 1)",
    id,
  )
  return id
}

describe('parent access: own child, approved summaries and consent only', () => {
  it('an unapproved AI summary is invisible to the parent and the case manager until the EA or teacher approves it', async () => {
    const h = createHarness()
    const id = insertDraftSummary(h, kai)
    expect((await h.get(U.parentKai, `/family/${kai}/summaries`)).body.summaries).toEqual([])
    expect((await h.get(U.caseManager, `/students/${kai}/summaries`)).body.summaries).toEqual([])
    // The EA and the teacher see the draft.
    expect((await h.get(U.ea, `/students/${kai}/summaries`)).body.summaries.map((s: { id: string }) => s.id)).toEqual([id])
    expect((await h.get(U.teacher, `/students/${kai}/summaries`)).body.summaries).toHaveLength(1)

    // Neither the parent nor the case manager can approve it.
    for (const user of [U.parentKai, U.caseManager, U.districtLead, U.schoolAdmin]) {
      expect((await h.post(user, `/family-summaries/${id}/approve?studentId=${kai}`, { expectedVersion: 1 })).status).toBe(403)
    }
    expect((await h.get(U.parentKai, `/family/${kai}/summaries`)).body.summaries).toEqual([])

    const approved = await h.post(U.ea, `/family-summaries/${id}/approve?studentId=${kai}`, { expectedVersion: 1, text: 'Edited and approved.' })
    expect(approved.status).toBe(200)
    expect(approved.body.summary).toMatchObject({ status: 'approved', approvedBy: U.ea, text: 'Edited and approved.' })
    expect((await h.get(U.parentKai, `/family/${kai}/summaries`)).body.summaries.map((s: { id: string }) => s.id)).toEqual([id])
    expect((await h.get(U.caseManager, `/students/${kai}/summaries`)).body.summaries).toHaveLength(1)
  })

  it('a parent cannot read another child, staff routes or removed routes', async () => {
    const h = createHarness()
    expect((await h.get(U.parentKai, `/family/${amara}/summaries`)).status).toBe(403)
    for (const path of [`/students/${kai}`, `/students/${kai}/timeline`, `/students/${kai}/objectives`, `/students/${kai}/what-works`, '/review-queue', `/students/${kai}/capture-objectives`]) {
      expect((await h.get(U.parentKai, path)).status, path).toBe(403)
    }
    expect((await h.get(U.parentKai, `/family/${kai}/progress`)).status).toBe(404)
    expect((await h.post(U.parentKai, `/family/${kai}/input`, { text: 'x', language: 'en' })).status).toBe(404)
  })

  it('parents toggle voice-note and video consent for their own child only', async () => {
    const h = createHarness()
    const on = await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'video', granted: true })
    expect(on.status).toBe(200)
    const off = await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'voice_note', granted: false })
    expect(off.body.consents.find((c: { kind: string }) => c.kind === 'voice_note').revokedAt).not.toBeNull()
    expect((await h.call(U.parentSofia, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: true })).status).toBe(403)
    // Staff cannot toggle consent for a family.
    for (const user of [U.caseManager, U.teacher, U.ea]) {
      expect((await h.call(user, 'PUT', `/family/${sofia}/consents`, { kind: 'voice_note', granted: true })).status).toBe(403)
    }
    expect((await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'student_mode', granted: true })).status).toBe(400)
    expect((await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'audio', granted: true })).status).toBe(400)
  })
})

describe('removed features have no routes', () => {
  it('Today View, handoffs, parent input, drafts and the digest answer 404', async () => {
    const h = createHarness()
    expect((await h.post(U.caseManager, `/students/${kai}/today-links`, { ttlHours: 2 })).status).toBe(404)
    expect((await h.get(null, '/today/some-token')).status).toBe(404)
    expect((await h.post(U.caseManager, `/students/${kai}/handoffs`, {})).status).toBe(404)
    expect((await h.get(U.caseManager, `/handoffs/x?studentId=${kai}`)).status).toBe(404)
    expect((await h.get(U.caseManager, `/students/${kai}/parent-input`)).status).toBe(404)
    expect((await h.post(U.caseManager, `/students/${kai}/drafts`, {})).status).toBe(404)
    expect((await h.call(U.caseManager, 'PATCH', `/drafts/x?studentId=${kai}`, {})).status).toBe(404)
    expect((await h.post(U.caseManager, `/drafts/x/family-summary?studentId=${kai}`, { language: 'es' })).status).toBe(404)
    expect((await h.get(U.caseManager, '/me/digest')).status).toBe(404)
    expect((await h.get(U.caseManager, '/me/proposals')).status).toBe(404)
  })
})
