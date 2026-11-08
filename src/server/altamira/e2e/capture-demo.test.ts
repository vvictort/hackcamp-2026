import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_HEADER } from '../middleware/auth'
import { closeAll } from '../services/testing'
import { amara, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

const page = (code: string) => ({ fileKey: `captures/1/sample-sheet-code-${code}.png`, contentType: 'image/png', bytesBase64: 'iVBORw0KGgo=' })

describe('capture demo flow (sample sheet, fallback scoring, EA goals, student mode start)', () => {
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

  it('student mode start: staff always, the linked student account only in the demo', async () => {
    const strict = createHarness()
    expect((await strict.post(U.ea, `/students/${kai}/student-mode/start`)).status).toBe(201)
    expect((await strict.post(U.parentKai, `/students/${kai}/student-mode/start`)).status).toBe(403)
    const demo = createHarness({ devSeed: true })
    const started = await demo.post(U.parentKai, `/students/${kai}/student-mode/start`)
    expect(started.status).toBe(201)
    expect((await demo.post(U.parentKai, `/students/${sofia}/student-mode/start`)).status).toBe(403)
    const next = await demo.get(null, `/sessions/${started.body.sessionId}/next`, { [SESSION_HEADER]: started.body.token })
    expect(next.status).toBe(200)
  })
})
