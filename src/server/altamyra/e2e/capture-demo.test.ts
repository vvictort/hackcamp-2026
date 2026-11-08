import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from './testing'
import { amara, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

const page = (code: string) => ({ fileKey: `captures/1/sample-sheet-code-${code}.png`, contentType: 'image/png', bytesBase64: 'iVBORw0KGgo=' })

describe('capture demo flow (sample sheet, fallback scoring, EA goals)', () => {
  it('sample-sheet is hidden without the dev flag', async () => {
    const h = createHarness()
    expect((await h.post(U.teacher, '/captures/sample-sheet', { studentId: sofia })).status).toBe(404)
  })

  it('scores a sample sheet with the AI failing, and routes it to review', async () => {
    const h = createHarness({
      devSeed: true,
      ai: {
        scorePhotoPage: async () => {
          throw new Error('provider down')
        },
      },
    })
    const sample = await h.post(U.teacher, '/captures/sample-sheet', { studentId: sofia })
    expect(sample.status).toBe(200)
    expect(sample.body.code).toMatch(/^AL-/)
    const batch = await h.post(U.teacher, '/captures/photos', { pages: [page(sample.body.code)] })
    expect(batch.status).toBe(201)
    expect(batch.body.batch.pages[0].status).toBe('scored')
    const queue = await h.get(U.teacher, '/review-queue')
    expect(queue.body.items.some((i: { studentId: string }) => i.studentId === sofia)).toBe(true)
  })

  it('an assigned EA can load the sample sheet; a case manager and an unassigned EA cannot', async () => {
    const h = createHarness({ devSeed: true })
    const sample = await h.post(U.ea, '/captures/sample-sheet', { studentId: kai })
    expect(sample.status).toBe(200)
    expect(sample.body.code).toMatch(/^AL-/)
    const batch = await h.post(U.ea, '/captures/photos', { pages: [page(sample.body.code)] })
    expect(batch.status).toBe(201)
    expect(batch.body.batch.pages[0].status).toBe('scored')
    expect((await h.post(U.caseManager, '/captures/sample-sheet', { studentId: kai })).status).toBe(403)
    expect((await h.post(U.ea, '/captures/sample-sheet', { studentId: amara })).status).toBe(403)
  })

  it('an assigned EA reads goals to record against and records an event; a stranger cannot', async () => {
    const h = createHarness()
    const goals = await h.get(U.ea, `/students/${kai}/capture-objectives`)
    expect(goals.status).toBe(200)
    expect(goals.body.objectives.length).toBeGreaterThan(0)
    const objectiveId = goals.body.objectives[0].objectiveId
    const ev = await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId, count: 3, classId: null, lessonId: null })
    expect(ev.status).toBe(201)
    expect((await h.get(U.ea, `/students/${amara}/capture-objectives`)).status).toBe(403)
  })

  it('student mode is gone', async () => {
    const h = createHarness({ devSeed: true })
    expect((await h.post(U.ea, `/students/${kai}/student-mode/start`)).status).toBe(404)
    expect((await h.post(U.ea, `/students/${kai}/sessions`)).status).toBe(404)
    expect((await h.get(null, '/sessions/x/next')).status).toBe(404)
  })
})
