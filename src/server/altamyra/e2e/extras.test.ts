import { afterEach, describe, expect, it } from 'vitest'
import { DISTRICT } from '../fixtures'
import { closeAll } from '../services/testing'
import { amara, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('remaining /api/v1 flows', () => {
  it('voice notes need the parent\'s voice-note consent (403 consent_required); the recording is deleted either way', async () => {
    const h = createHarness()
    const audio = (key: string) => ({ audio: { fileKey: key, contentType: 'audio/webm' } })
    const refused = await h.post(U.teacher, `/students/${amara}/voice-notes`, audio('ea/note-1.webm'))
    expect(refused.status).toBe(403)
    expect(refused.body.error.message).toContain('consent_required')
    expect(h.deletedFiles).toContain('ea/note-1.webm')
    expect(h.aiCalls.parseVoiceNote).toBe(0)

    // Only confirmed objectives are offered to the parser; confirm Sofía's counter objective first.
    const objectives = (await h.get(U.caseManager, `/students/${sofia}/objectives`)).body.objectives
    const counter = objectives.find((o: { metricType: string }) => o.metricType === 'frequency')
    expect((await h.post(U.caseManager, `/objectives/${counter.id}/confirm?studentId=${sofia}`, { expectedVersion: counter.version })).status).toBe(200)

    const ok = await h.post(U.ea,`/students/${sofia}/voice-notes`, audio('ea/note-2.webm'))
    expect(ok.status, String(h.errors[0])).toBe(201)
    expect(ok.body.audioDeleted).toBe(true)
    expect(ok.body.dataPoints.length).toBeGreaterThan(0)
    expect(h.deletedFiles).toContain('ea/note-2.webm')
  })

  it('voice notes follow the parent toggle: off refuses, on accepts', async () => {
    const h = createHarness()
    const note = (key: string) => ({ audio: { fileKey: key, contentType: 'audio/webm' } })
    expect((await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'voice_note', granted: false })).status).toBe(200)
    const off = await h.post(U.ea, `/students/${sofia}/voice-notes`, note('ea/off.webm'))
    expect(off.status).toBe(403)
    expect(off.body.error.message).toContain('consent_required')
    expect(h.aiCalls.parseVoiceNote).toBe(0)
    expect((await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'voice_note', granted: true })).status).toBe(200)
    expect((await h.post(U.ea, `/students/${sofia}/voice-notes`, note('ea/on.webm'))).status).toBe(201)
    // A video consent does not unlock voice notes.
    expect((await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: true })).status).toBe(200)
    expect((await h.post(U.ea, `/students/${kai}/voice-notes`, note('ea/kai.webm'))).status).toBe(403)
  })

  it('district insights: district lead only, small groups suppressed', async () => {
    const h = createHarness()
    const res = await h.get(U.districtLead, `/districts/${DISTRICT.id}/insights?groupBy=goalArea`)
    expect(res.status).toBe(200)
    for (const g of res.body.groups) if (g.suppressed) expect(g.students).toBeNull()
    expect((await h.get(U.caseManager, `/districts/${DISTRICT.id}/insights`)).status).toBe(403)
  })
})
