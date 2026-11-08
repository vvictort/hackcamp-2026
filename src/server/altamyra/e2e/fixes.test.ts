import { afterEach, describe, expect, it } from 'vitest'
import { CBIEP_SAMPLE_TEXT, SOFIA } from '../fixtures'
import { closeAll } from './testing'
import { amara, approvedMathSheets, fictionalPdf, kai, sofia, toBase64, U } from './flows'
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

describe('EA scope: assigned students, full history (role model)', () => {
  it('aimline, goal status and data point sources show the same history to the EA and the teacher', async () => {
    const h = createHarness()
    const teacherLine = await h.get(U.teacher, `/students/${sofia}/goals/${sofiaMathGoal}/aimline`)
    const eaLine = await h.get(U.ea, `/students/${sofia}/goals/${sofiaMathGoal}/aimline`)
    expect(eaLine.status).toBe(200)
    expect(eaLine.body.points.length).toBeGreaterThan(0)
    expect(eaLine.body).toEqual(teacherLine.body)
    const status = await h.get(U.ea, `/students/${sofia}/goals/${sofiaMathGoal}/status`)
    expect(status.status).toBe(200)
    expect((await h.get(U.ea, `/data-points/${sofiaOldPoint}/source?studentId=${sofia}`)).status).toBe(200)
  })

  it('an EA reads the supports view and objectives of an assigned student only', async () => {
    const h = createHarness()
    const profile = await h.get(U.ea, `/students/${kai}`)
    expect(profile.status).toBe(200)
    expect(profile.body.view).toBe('supports')
    expect(profile.body.sections ?? null).toBeNull()
    expect((await h.get(U.ea, `/students/${kai}/objectives`)).status).toBe(200)
    expect((await h.get(U.ea, `/students/${amara}`)).status).toBe(403)
    expect((await h.get(U.ea, `/students/${amara}/objectives`)).status).toBe(403)
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

describe('IEP import fixes', () => {
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
})
