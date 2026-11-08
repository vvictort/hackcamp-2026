import { afterEach, describe, expect, it } from 'vitest'
import { CBIEP_SAMPLE_TEXT, SCHOOL } from '../fixtures'
import { closeAll } from '../services/testing'
import { amara, approvedMathSheets, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('M2 measurement core through /api/v1', () => {
  it('case manager imports a CB-IEP, confirms it side by side, then confirms the proposed objectives', async () => {
    const h = createHarness()
    const imported = await h.post(U.caseManager, `/students/${kai}/iep/import`, { sourceKind: 'text', text: CBIEP_SAMPLE_TEXT })
    expect(imported.status).toBe(200)
    expect(imported.body.iep.version).toBe(2)
    expect(imported.body.iep.confirmedAt).toBeNull()
    expect(imported.body.goals.length).toBeGreaterThan(0)
    expect(imported.body.objectiveProposals).toHaveLength(imported.body.goals.length)
    expect(h.aiCalls.proposeObjectives).toBe(imported.body.goals.length)
    // De-identified: no AI request carries the student's name.
    expect(JSON.stringify(h.aiRequests)).not.toContain('Kai')

    const confirmed = await h.post(U.caseManager, `/students/${kai}/iep/2/confirm`, { expectedVersion: imported.body.iep.rowVersion })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.iep.confirmedBy).toBe(U.caseManager)

    const goalIds = new Set(imported.body.goals.map((g: { id: string }) => g.id))
    const objectives = await h.get(U.caseManager, `/students/${kai}/objectives`)
    const proposed = objectives.body.objectives.filter((o: { goalId: string; status: string }) => goalIds.has(o.goalId) && o.status === 'proposed')
    expect(proposed.length).toBeGreaterThan(0)
    for (const o of proposed) {
      const res = await h.post(U.caseManager, `/objectives/${o.id}/confirm?studentId=${kai}`, { expectedVersion: o.version })
      expect(res.status).toBe(200)
      expect(res.body.objective).toMatchObject({ status: 'confirmed', confirmedBy: U.caseManager })
    }
  })

  it('teacher proposals are gone', async () => {
    const h = createHarness()
    expect((await h.post(U.teacher, `/students/${kai}/proposals`, { target: 'iep', change: {} })).status).toBe(404)
    expect((await h.get(U.caseManager, '/me/proposals')).status).toBe(404)
    expect((await h.post(U.caseManager, `/proposals/x/resolve?studentId=${kai}`, {})).status).toBe(404)
  })

  it('photo batch: coded sheet scored, low confidence goes to the review queue, teacher confirms', async () => {
    const h = createHarness({
      devSeed: true,
      ai: {
        // A shaky photo: every item read with low confidence.
        scorePhotoPage: async (input) => ({ sheetCode: null, items: input.check.items.map((i) => ({ itemId: i.id, value: 1, confidence: 0.3 })) }),
      },
    })
    const { sheets } = await approvedMathSheets(h, sofia)
    const page = sheets.pages[0]
    const batch = await h.post(U.teacher, '/captures/photos', {
      pages: [
        { fileKey: `captures/sheet-code-${page.sheetCode}.jpg`, contentType: 'image/jpeg' },
        { fileKey: 'captures/blurry.jpg', contentType: 'image/jpeg' },
      ],
    })
    expect(batch.status).toBe(201)
    const [scored, unreadable] = batch.body.batch.pages
    expect(scored).toMatchObject({ status: 'scored', studentId: sofia, sheetCode: page.sheetCode })
    expect(unreadable).toMatchObject({ status: 'unreadable_code', studentId: null })

    const fetched = await h.get(U.teacher, `/captures/${batch.body.batch.id}`)
    expect(fetched.body.batch.pages).toHaveLength(2)

    const queue = await h.get(U.teacher, '/review-queue')
    const entry = queue.body.items.find((i: { dataPoint: { id: string } }) => i.dataPoint.id === scored.dataPointIds[0])
    expect(entry).toBeDefined()
    expect(entry.item.kind).toBe('low_confidence')
    expect(entry.dataPoint).toMatchObject({ status: 'pending_review', source: 'photo', value: 100 })

    const source = await h.get(U.teacher, `/data-points/${entry.dataPoint.id}/source?studentId=${sofia}`)
    expect(source.body.source).toMatchObject({ kind: 'photo', fileKey: `captures/sheet-code-${page.sheetCode}.jpg` })

    const ok = await h.post(U.teacher, `/review-queue/${entry.item.id}/confirm?studentId=${sofia}`, { expectedVersion: entry.item.version })
    expect(ok.status).toBe(200)
    expect(ok.body.dataPoint.status).toBe('confirmed')
    const after = await h.get(U.teacher, '/review-queue')
    expect(after.body.items.find((i: { item: { id: string } }) => i.item.id === entry.item.id)).toBeUndefined()
  })

  it('EA (newly assigned by the admin) records prompt levels; timeline and goal status show them; corrections are new versions', async () => {
    const h = createHarness()
    // Amara is not on the EA's caseload until the school administrator assigns her.
    expect((await h.get(U.ea, `/students/${amara}/timeline`)).status).toBe(403)
    const grant = await h.post(U.schoolAdmin, `/admin/schools/${SCHOOL.id}/memberships`, {
      kind: 'membership',
      userId: U.ea,
      displayName: 'Fictional EA',
      role: 'ea',
      studentId: amara,
    })
    expect(grant.status).toBe(200)

    // Amara's prompt-level objective is still proposed; the case manager confirms it first.
    const objectives = await h.get(U.caseManager, `/students/${amara}/objectives`)
    const proposed = objectives.body.objectives.find((o: { metricType: string }) => o.metricType === 'prompt_level')
    const confirmed = await h.post(U.caseManager, `/objectives/${proposed.id}/confirm?studentId=${amara}`, { expectedVersion: proposed.version })
    expect(confirmed.status).toBe(200)
    const objective = confirmed.body.objective

    const levels = ['full_physical', 'gesture', 'independent'] as const
    const ids: string[] = []
    for (const [i, promptLevel] of levels.entries()) {
      const res = await h.post(U.ea, `/students/${amara}/events`, {
        kind: 'prompt_level',
        objectiveId: objective.id,
        promptLevel,
        recordedAt: `2026-11-0${i + 2}T18:00:00.000Z`,
      })
      expect(res.status).toBe(201)
      expect(res.body.dataPoint).toMatchObject({ source: 'ea', recorderId: U.ea })
      ids.push(res.body.dataPoint.id)
    }

    const timeline = await h.get(U.caseManager, `/students/${amara}/timeline?objectiveId=${objective.id}`)
    expect(timeline.status).toBe(200)
    expect(timeline.body.dataPoints.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(ids))

    const status = await h.get(U.caseManager, `/students/${amara}/goals/${objective.goalId}/status`)
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({ goalId: objective.goalId, objectiveId: objective.id, metricType: 'prompt_level', recentCount: 3 })
    // Fewer than 6 points: no decision rule yet.
    expect(status.body.latestDecision).toBeNull()

    const corrected = await h.post(U.ea, `/data-points/${ids[1]}/correct?studentId=${amara}`, { expectedVersion: 1, value: 3, reason: 'Tapped the wrong level' })
    expect(corrected.status).toBe(200)
    expect(corrected.body.dataPoint).toMatchObject({ supersedesId: ids[1], version: 2 })
    const conflict = await h.post(U.ea, `/data-points/${ids[1]}/correct?studentId=${amara}`, { expectedVersion: 1, value: 2, reason: 'again' })
    expect(conflict.status).toBe(409)
  })
})
