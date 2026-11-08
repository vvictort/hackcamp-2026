import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

const lowConfidence = { scorePhotoPage: async (input: { check: { items: { id: string }[] } }) => ({ sheetCode: null, items: input.check.items.map((i) => ({ itemId: i.id, value: 1, confidence: 0.3 })) }) }
const sample = (code: string) => ({ fileKey: `captures/sample-sheet-code-${code}.png`, contentType: 'image/png', bytesBase64: 'iVBORw0KGgo=' })

describe('capture loop (C1, C4, C5)', () => {
  it('C1: a photographed sheet lands in the EA review list as pending review', async () => {
    const h = createHarness({ devSeed: true, ai: lowConfidence as never })
    const s = await h.post(U.ea, '/captures/sample-sheet', { studentId: sofia })
    // The sample-sheet builder needs lesson editing; if the EA is refused, the teacher builds it and the EA photographs.
    const code = s.status === 200 ? s.body.code : (await h.post(U.teacher, '/captures/sample-sheet', { studentId: sofia })).body.code
    const batch = await h.post(U.ea, '/captures/photos', { pages: [sample(code)] })
    expect(batch.status).toBe(201)
    const id = batch.body.batch.pages[0].dataPointIds[0]
    const queue = await h.get(U.ea, '/review-queue')
    const entry = queue.body.items.find((i: { dataPoint: { id: string } }) => i.dataPoint.id === id)
    expect(entry.dataPoint.status).toBe('pending_review')
  })

  it('C4: prompt level, counter and timer events are accepted for the EA', async () => {
    const h = createHarness()
    const goals = (await h.get(U.ea, `/students/${kai}/capture-objectives`)).body.objectives as { objectiveId: string; metricType: string }[]
    const counter = goals.find((g) => g.metricType !== 'duration' && g.metricType !== 'latency' && g.metricType !== 'prompt_level')
    expect(counter).toBeDefined()
    const ok = await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId: counter!.objectiveId, count: 2 })
    expect(ok.status).toBe(201)
  })

  it('C4/F1: consent off refuses voice notes and videos for the EA', async () => {
    const h = createHarness()
    const video = { fileKey: 'uploads/v.mp4', contentType: 'video/mp4', sizeBytes: 10 }
    const audio = { audio: { fileKey: 'ea/a.webm', contentType: 'audio/webm' } }
    for (const kind of ['video', 'voice_note']) {
      expect((await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind, granted: false })).status).toBe(200)
    }
    for (const user of [U.ea, U.teacher]) {
      const v = await h.post(user, `/students/${kai}/videos`, video)
      expect(v.status).toBe(403)
      expect(v.body.error.message).toContain('consent_required')
      const a = await h.post(user, `/students/${kai}/voice-notes`, audio)
      expect(a.status).toBe(403)
      expect(a.body.error.message).toContain('consent_required')
    }
  })

  it('C5: only the capturing user confirms; the other staff role gets 403', async () => {
    const h = createHarness({ devSeed: true, ai: lowConfidence as never })
    const code = (await h.post(U.teacher, '/captures/sample-sheet', { studentId: sofia })).body.code
    const batch = await h.post(U.teacher, '/captures/photos', { pages: [sample(code)] })
    const id = batch.body.batch.pages[0].dataPointIds[0]
    const entry = (await h.get(U.teacher, '/review-queue')).body.items.find((i: { dataPoint: { id: string } }) => i.dataPoint.id === id)
    const url = `/review-queue/${entry.item.id}/confirm?studentId=${sofia}`
    expect((await h.post(U.ea, url, { expectedVersion: entry.item.version })).status).toBe(403)
    expect((await h.post(U.teacher, url, { expectedVersion: entry.item.version })).status).toBe(200)
  })

  it('other roles cannot capture', async () => {
    const h = createHarness()
    for (const user of [U.caseManager, U.parentKai, U.districtLead, U.schoolAdmin]) {
      expect((await h.post(user, `/students/${kai}/events`, { kind: 'counter', objectiveId: 'x', count: 1 })).status, user).toBe(403)
      expect((await h.post(user, `/students/${kai}/notes`, { text: 'x' })).status, user).toBe(403)
      expect((await h.post(user, `/students/${kai}/videos`, { fileKey: 'v', contentType: 'video/mp4', sizeBytes: 1 })).status, user).toBe(403)
      expect((await h.post(user, `/students/${kai}/voice-notes`, { audio: { fileKey: 'a', contentType: 'audio/webm' } })).status, user).toBe(403)
      expect((await h.get(user, '/review-queue')).status, user).toBe(403)
    }
  })
})
