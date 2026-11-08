import { afterEach, describe, expect, it } from 'vitest'
import { FAMILY_VISIBLE_STATUSES } from '../contract/enums'
import { closeAll } from '../services/testing'
import { approvedMathSheets, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('M4 families, Today View and handoff through /api/v1', () => {
  it('parents see only confirmed data, never a pending AI score', async () => {
    const h = createHarness({
      ai: { scorePhotoPage: async (input) => ({ sheetCode: null, items: input.check.items.map((i) => ({ itemId: i.id, value: 0, confidence: 0.2 })) }) },
    })
    const { lesson, sheets } = await approvedMathSheets(h, sofia)
    const batch = await h.post(U.teacher, '/captures/photos', {
      pages: [{ fileKey: `captures/sheet-code-${sheets.pages[0].sheetCode}.jpg`, contentType: 'image/jpeg' }],
    })
    const pendingId = batch.body.batch.pages[0].dataPointIds[0]
    expect(h.studentSql(sofia).get<{ status: string }>('SELECT status FROM data_points WHERE id = ?', pendingId)?.status).toBe('pending_review')

    const family = await h.get(U.parentSofia, `/family/${sofia}/progress`)
    expect(family.status).toBe(200)
    const points = family.body.goals.flatMap((g: { dataPoints: { id: string; status: string }[] }) => g.dataPoints)
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) expect(FAMILY_VISIBLE_STATUSES).toContain(p.status)
    expect(points.map((p: { id: string }) => p.id)).not.toContain(pendingId)
    // Approved adaptations show with the real lesson title.
    expect(family.body.lessons).toEqual([expect.objectContaining({ lessonId: lesson.id, title: lesson.title })])

    // Parents send input and manage consent for their own child.
    expect((await h.post(U.parentSofia, `/family/${sofia}/input`, { text: 'Practised counting at home.', language: 'en' })).status).toBe(201)
    const consents = await h.call(U.parentSofia, 'PUT', `/family/${sofia}/consents`, { kind: 'audio', granted: false })
    expect(consents.status).toBe(200)
    expect(consents.body.consents.find((c: { kind: string }) => c.kind === 'audio').revokedAt).not.toBeNull()
  })

  it('Today View link works without login, shows no IEP goal text, and expires with 410', async () => {
    const h = createHarness()
    const link = await h.post(U.caseManager, `/students/${kai}/today-links`, { ttlHours: 2 })
    expect(link.status).toBe(201)
    const view = await h.get(null, `/today/${link.body.token}`)
    expect(view.status).toBe(200)
    expect(view.body.supports.length).toBeGreaterThan(0)
    expect(view.body.schedule.length).toBeGreaterThan(0)
    const text = JSON.stringify(view.body)
    for (const g of h.studentSql(kai).all<{ text: string }>('SELECT text FROM goals')) expect(text).not.toContain(g.text)
    // Only the hash is stored.
    expect(h.school.get<{ n: number }>('SELECT COUNT(*) AS n FROM share_tokens WHERE token_hash = ?', link.body.token)?.n).toBe(0)

    expect((await h.get(null, '/today/not-a-real-token')).status).toBe(404)
    h.clock.now += 3 * 60 * 60 * 1000
    const expired = await h.get(null, `/today/${link.body.token}`)
    expect(expired.status).toBe(410)
    expect(expired.body.error.code).toBe('gone')
  })

  it('case manager creates a transition handoff and reads it back', async () => {
    const h = createHarness()
    const created = await h.post(U.caseManager, `/students/${kai}/handoffs`, { toSchool: 'Fictional Middle School' })
    expect(created.status).toBe(201)
    expect(created.body.handoff.packet.goals.length).toBeGreaterThan(0)
    const read = await h.get(U.caseManager, `/handoffs/${created.body.handoff.id}?studentId=${kai}`)
    expect(read.status).toBe(200)
    expect(read.body.handoff.id).toBe(created.body.handoff.id)
    // Parents cannot read handoffs.
    expect((await h.get(U.parentKai, `/handoffs/${created.body.handoff.id}?studentId=${kai}`)).status).toBe(403)
  })
})
