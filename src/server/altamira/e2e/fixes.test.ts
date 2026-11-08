import { afterEach, describe, expect, it } from 'vitest'
import { CBIEP_SAMPLE_TEXT, SOFIA } from '../fixtures'
import { closeAll } from '../services/testing'
import { approveAdaptation, approvedMathSheets, fictionalPdf, kai, sofia, toBase64, U } from './flows'
import { createHarness, type Harness } from './harness'

afterEach(closeAll)

/** FICTIONAL name that is not in the fixture roster, so only the per-request roster can strip it. */
const ZORBLAX_IEP = CBIEP_SAMPLE_TEXT.replace('Legal Name: Kai Nakamura', 'Legal Name: Zorblax Quentworth').replace(
  '- Strong visual memory',
  '- Zorblax has strong visual memory',
)

async function importAndConfirm(h: Harness, text: string) {
  const imported = await h.post(U.caseManager, `/students/${kai}/iep/import`, { sourceKind: 'text', text })
  expect(imported.status, JSON.stringify(imported.body)).toBe(200)
  const confirmed = await h.post(U.caseManager, `/students/${kai}/iep/${imported.body.iep.version}/confirm`, { expectedVersion: imported.body.iep.rowVersion })
  expect(confirmed.status).toBe(200)
  return imported.body
}

const sofiaMathGoal = SOFIA.objectives[0].goalId
const sofiaOldPoint = SOFIA.dataPoints[0].id

describe('de-identification roster built from real data (PRD NFR Privacy)', () => {
  it('a student name outside the fixtures never reaches the provider on IEP import', async () => {
    const h = createHarness()
    await importAndConfirm(h, ZORBLAX_IEP)
    expect(h.aiRequests.length).toBeGreaterThan(0)
    const sent = JSON.stringify(h.aiRequests)
    expect(sent).not.toContain('Zorblax')
    expect(sent).not.toContain('Quentworth')
  })
})

describe('voice notes: the recording never outlives the request (PRD NFR Consent)', () => {
  it('is deleted, and the deletion audited, when parsing fails', async () => {
    const h = createHarness({
      ai: {
        parseVoiceNote: async () => {
          throw new Error('model unavailable')
        },
      },
    })
    const res = await h.post(U.ea, `/students/${sofia}/voice-notes`, { audio: { fileKey: 'ea/note-fail.webm', contentType: 'audio/webm' } })
    expect(res.status).toBe(500)
    expect(h.deletedFiles).toContain('ea/note-fail.webm')
    const row = h.studentSql(sofia).get<{ after_json: string }>("SELECT after_json FROM audit_log WHERE action = 'voice_notes.audio_deleted' AND row_id = 'ea/note-fail.webm'")
    expect(JSON.parse(row!.after_json)).toEqual({ processed: false })
  })

  it('offers the parser confirmed objectives only, without IEP text', async () => {
    const h = createHarness()
    const res = await h.post(U.ea, `/students/${sofia}/voice-notes`, { audio: { fileKey: 'ea/note-3.webm', contentType: 'audio/webm' } })
    expect(res.status).toBe(201)
    const input = h.aiRequests.find((r) => r.fn === 'parseVoiceNote')!.input as { objectives: { objectiveId: string; description: string }[] }
    expect(input.objectives.map((o) => o.objectiveId)).toEqual([SOFIA.objectives[0].id])
    expect(JSON.stringify(input)).not.toContain(SOFIA.objectives[0].masteryRule)
  })
})

describe('EA scope: assigned students, today (PRD matrix)', () => {
  it('aimline, goal status and data point sources show nothing from before today', async () => {
    const h = createHarness()
    const teacherLine = await h.get(U.teacher, `/students/${sofia}/goals/${sofiaMathGoal}/aimline`)
    expect(teacherLine.body.points.length).toBeGreaterThan(0)
    const eaLine = await h.get(U.ea, `/students/${sofia}/goals/${sofiaMathGoal}/aimline`)
    expect(eaLine.status).toBe(200)
    expect(eaLine.body).toEqual({ start: null, end: null, points: [] })
    const status = await h.get(U.ea, `/students/${sofia}/goals/${sofiaMathGoal}/status`)
    expect(status.body).toMatchObject({ current: null, recentCount: 0, trend: null })
    expect((await h.get(U.ea, `/data-points/${sofiaOldPoint}/source?studentId=${sofia}`)).status).toBe(404)
    expect((await h.get(U.teacher, `/data-points/${sofiaOldPoint}/source?studentId=${sofia}`)).status).toBe(200)
  })

  it('EAs cannot list IEP objectives', async () => {
    const h = createHarness()
    expect((await h.get(U.ea, `/students/${kai}/objectives`)).status).toBe(403)
  })

  it('"today" is the school day in Vancouver, not the UTC day', async () => {
    const h = createHarness()
    const counter = SOFIA.objectives[1]
    await h.post(U.caseManager, `/objectives/${counter.id}/confirm?studentId=${sofia}`, { expectedVersion: counter.version })
    // 10:00 Vancouver on Monday 2026-11-09.
    const event = await h.post(U.ea, `/students/${sofia}/events`, { kind: 'counter', objectiveId: counter.id, count: 2, recordedAt: '2026-11-09T18:00:00.000Z' })
    expect(event.status).toBe(201)
    // 16:30 Vancouver the same day is already 2026-11-10 in UTC.
    h.clock.now = Date.parse('2026-11-10T00:30:00.000Z')
    const timeline = await h.get(U.ea, `/students/${sofia}/timeline`)
    expect(timeline.body.dataPoints.map((p: { id: string }) => p.id)).toEqual([event.body.dataPoint.id])
  })
})

describe('photo scoring', () => {
  it('the review sample is seeded on the server, and the point links to its item and class', async () => {
    const confident = { scorePhotoPage: async (input: { check: { items: { id: string }[] } }) => ({ sheetCode: null, items: input.check.items.map((i, n) => ({ itemId: i.id, value: 1, confidence: 0.95 - n * 0.01 })) }) }
    for (const sampleEverything of [false, true]) {
      const h = createHarness({ devSeed: true, sampleEverything, ai: confident })
      const { sheets, lesson } = await approvedMathSheets(h, sofia)
      const page = sheets.pages[0]
      // The same client-chosen file key routes differently: the sample does not depend on request input.
      const batch = await h.post(U.teacher, '/captures/photos', { pages: [{ fileKey: `captures/sheet-code-${page.sheetCode}.jpg`, contentType: 'image/jpeg' }] })
      const id = batch.body.batch.pages[0].dataPointIds[0]
      const source = await h.get(U.teacher, `/data-points/${id}/source?studentId=${sofia}`)
      expect(source.body.dataPoint.status).toBe(sampleEverything ? 'pending_review' : 'auto_confirmed')
      const lastItem = page.checkItems[page.checkItems.length - 1].id
      expect(source.body.source).toMatchObject({ kind: 'photo', itemId: lastItem })
      expect(source.body.dataPoint.lessonId).toBe(lesson.id)
      expect(source.body.dataPoint.classId).toEqual(expect.any(String))
    }
  })
})

describe('Lens approval route (replaces the removed 1A routes)', () => {
  it('a modification the IEP does not authorize is blocked and stores nothing (PRD 1A-5)', async () => {
    const h = createHarness()
    const res = await approveAdaptation(h, kai, { label: 'modify', adaptationType: 'modified_assessment' })
    expect(res.status).toBe(201)
    expect(res.body.blocked.length).toBe(1)
    expect(res.body.lessonId).toBeNull()
    expect(h.studentSql(kai).get<{ n: number }>('SELECT COUNT(*) AS n FROM usage_events')?.n).toBe(0)
  })
})

describe('M2/M4 reads and imports added by the fix pass', () => {
  it('the case manager reads what parents sent', async () => {
    const h = createHarness()
    const sent = await h.post(U.parentKai, `/family/${kai}/input`, { text: 'He slept badly this week.', language: 'en' })
    expect(sent.status).toBe(201)
    const inbox = await h.get(U.caseManager, `/students/${kai}/parent-input`)
    expect(inbox.status).toBe(200)
    expect(inbox.body.inputs.map((i: { id: string }) => i.id)).toEqual([sent.body.input.id])
    expect((await h.get(U.teacher, `/students/${kai}/parent-input`)).status).toBe(403)
    expect((await h.get(U.parentKai, `/students/${kai}/parent-input`)).status).toBe(403)
  })

  it('an unmeasurable goal is stored as flagged for the IEP team', async () => {
    const h = createHarness({ ai: { proposeObjectives: async (input) => ({ measurable: false, goalId: input.goalId, reason: 'No observable behaviour' }) } })
    const body = await importAndConfirm(h, CBIEP_SAMPLE_TEXT)
    const objectives = (await h.get(U.caseManager, `/students/${kai}/objectives`)).body.objectives
    const flagged = objectives.filter((o: { status: string; goalId: string }) => o.status === 'flagged_unmeasurable')
    expect(flagged.map((o: { goalId: string }) => o.goalId).sort()).toEqual(body.goals.map((g: { id: string }) => g.id).sort())
    expect(flagged[0].flagReason).toBe('No observable behaviour')
  })

  it('imports a CB-IEP PDF from its text layer; the file is never sent to the model', async () => {
    const h = createHarness()
    const bytes = await fictionalPdf(CBIEP_SAMPLE_TEXT.split('\n').filter((l) => l.trim()), true)
    const res = await h.post(U.caseManager, `/students/${kai}/iep/import`, {
      sourceKind: 'pdf',
      file: { fileKey: 'iep/kai-cbiep.pdf', contentType: 'application/pdf', bytesBase64: toBase64(bytes) },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.iep.sections.student.firstName).toBe('Kai')
    expect(res.body.iep.sourceFileKey).toBe('iep/kai-cbiep.pdf')
    expect(JSON.stringify(h.aiRequests)).not.toContain('bytesBase64')
    const noText = await h.post(U.caseManager, `/students/${kai}/iep/import`, {
      sourceKind: 'pdf',
      file: { fileKey: 'iep/scan.pdf', contentType: 'application/pdf', bytesBase64: toBase64(new TextEncoder().encode('%PDF-1.4\n%%EOF')) },
    })
    expect(noText.status).toBe(400)
  })

  it('the handoff packet carries suggested next goals', async () => {
    const h = createHarness()
    const res = await h.post(U.caseManager, `/students/${kai}/handoffs`, { toSchool: null })
    expect(res.status).toBe(201)
    expect(res.body.handoff.packet.suggestedNextGoals.length).toBe(res.body.handoff.packet.goals.length)
  })
})
