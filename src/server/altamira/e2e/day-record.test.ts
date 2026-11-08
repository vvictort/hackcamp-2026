import { afterEach, describe, expect, it } from 'vitest'
import { ACTORS, closeAll, runStudent } from '../services/testing'
import { amara, kai, sofia, TODAY, U } from './flows'
import { createHarness, type Harness } from './harness'

afterEach(closeAll)

const objectiveOf = async (h: Harness, studentId: string = kai) => (await h.get(U.ea, `/students/${studentId}/capture-objectives`)).body.objectives[0].objectiveId as string
const video = { fileKey: 'uploads/video-1.mp4', contentType: 'video/mp4', sizeBytes: 1_000_000 }

describe('typed notes', () => {
  it('the EA and the teacher save a note to today; others are refused', async () => {
    const h = createHarness()
    const objectiveId = await objectiveOf(h)
    const res = await h.post(U.ea, `/students/${kai}/notes`, { objectiveId, text: '  Used the break card twice before math.  ' })
    expect(res.status).toBe(201)
    expect(res.body.note).toMatchObject({ objectiveId, text: 'Used the break card twice before math.', recorderId: U.ea })
    expect((await h.post(U.teacher, `/students/${kai}/notes`, { text: 'Calm start to the day.' })).status).toBe(201)

    const day = await h.get(U.ea, `/students/${kai}/days/${TODAY}`)
    expect(day.body.notes.map((n: { text: string }) => n.text)).toEqual(['Used the break card twice before math.', 'Calm start to the day.'])

    expect((await h.post(U.ea, `/students/${kai}/notes`, { text: '' })).status).toBe(400)
    expect((await h.post(U.ea, `/students/${kai}/notes`, { text: 'x'.repeat(2001) })).status).toBe(400)
    expect((await h.post(U.ea, `/students/${kai}/notes`, { objectiveId: 'nope', text: 'x' })).status).toBe(404)
    for (const user of [U.caseManager, U.parentKai, U.districtLead, U.schoolAdmin]) {
      expect((await h.post(user, `/students/${kai}/notes`, { text: 'x' })).status).toBe(403)
    }
    expect((await h.post(U.ea, `/students/${amara}/notes`, { text: 'Not my student.' })).status).toBe(403)
  })
})

describe('videos need the parent consent', () => {
  it('refuses with consent_required and deletes the upload when consent is off, stores it when on', async () => {
    const h = createHarness()
    // The fixtures grant Kai's video consent; the parent turns it off.
    await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: false })
    const refused = await h.post(U.ea, `/students/${kai}/videos`, video)
    expect(refused.status).toBe(403)
    expect(refused.body.error.message).toContain('consent_required')
    expect(h.deletedFiles).toContain(video.fileKey)
    expect((await h.get(U.ea, `/students/${kai}/days/${TODAY}`)).body.videos).toEqual([])

    expect((await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: true })).status).toBe(200)
    const ok = await h.post(U.ea, `/students/${kai}/videos`, { ...video, objectiveId: await objectiveOf(h) })
    expect(ok.status).toBe(201)
    expect(ok.body.video).toMatchObject({ storageKey: video.fileKey, contentType: 'video/mp4', sizeBytes: 1_000_000, recorderId: U.ea })
    expect(h.deletedFiles).toHaveLength(1)
    const day = await h.get(U.ea, `/students/${kai}/days/${TODAY}`)
    expect(day.body.videos.map((v: { id: string }) => v.id)).toEqual([ok.body.video.id])

    // Consent turned off again refuses the next one.
    await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: false })
    expect((await h.post(U.teacher, `/students/${kai}/videos`, { ...video, fileKey: 'uploads/video-2.mp4' })).status).toBe(403)
  })

  it('only video files, only staff', async () => {
    const h = createHarness()
    await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: true })
    expect((await h.post(U.ea, `/students/${kai}/videos`, { ...video, contentType: 'image/png' })).status).toBe(400)
    expect((await h.post(U.ea, `/students/${kai}/videos`, { ...video, sizeBytes: -1 })).status).toBe(400)
    for (const user of [U.caseManager, U.parentKai, U.districtLead]) {
      expect((await h.post(user, `/students/${kai}/videos`, video)).status).toBe(403)
    }
  })
})

describe('days', () => {
  it('lists counts per day and opens one day with everything logged', async () => {
    const h = createHarness()
    const objectiveId = await objectiveOf(h)
    await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId, count: 3, classId: null, lessonId: null })
    await h.post(U.ea, `/students/${kai}/notes`, { text: 'A fictional note.' })
    runStudent(
      h.studentSql(kai),
      'dataPoints.addPending',
      { studentId: kai, objectiveId, value: 5, aiConfidence: 0.2, routing: { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: 'photo:captures/1/page.png#q1', now: new Date(h.clock.now).toISOString() },
      ACTORS.ea,
    )

    const list = await h.get(U.ea, `/students/${kai}/days`)
    expect(list.status).toBe(200)
    const today = list.body.days.find((d: { date: string }) => d.date === TODAY)
    expect(today).toMatchObject({ counts: { dataPoints: 1, events: 1, notes: 1, videos: 0, voiceNotes: 0 }, reviewed: false })
    // Kai's seeded October data shows up as earlier days, oldest first, inside the default 30 days.
    const dates = list.body.days.map((d: { date: string }) => d.date)
    expect(dates).toEqual([...dates].sort())
    expect(list.body.days.length).toBeGreaterThan(1)
    expect((await h.get(U.ea, `/students/${kai}/days?from=2026-11-10&to=2026-11-12`)).body.days).toEqual([])
    expect((await h.get(U.ea, `/students/${kai}/days?from=2026-11-12&to=2026-11-10`)).status).toBe(400)
    expect((await h.get(U.ea, `/students/${kai}/days?from=yesterday`)).status).toBe(400)

    const detail = await h.get(U.ea, `/students/${kai}/days/${TODAY}`)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({ date: TODAY, review: null, dailySummary: null, videos: [], voiceNotes: [] })
    expect(detail.body.events).toHaveLength(1)
    expect(detail.body.dataPoints).toHaveLength(1)
    expect(detail.body.dataPoints[0].status).toBe('pending_review')
    expect(detail.body.notes).toHaveLength(1)
    expect((await h.get(U.ea, `/students/${kai}/days/not-a-date`)).status).toBe(400)
  })

  it('the case manager sees confirmed data only and never a daily summary; parent and district are refused', async () => {
    const h = createHarness()
    const objectiveId = await objectiveOf(h)
    await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId, count: 1, classId: null, lessonId: null })
    runStudent(
      h.studentSql(kai),
      'dataPoints.addPending',
      { studentId: kai, objectiveId, value: 5, aiConfidence: 0.2, routing: { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: 'photo:captures/1/page.png#q1', now: new Date(h.clock.now).toISOString() },
      ACTORS.ea,
    )
    await h.post(U.ea, `/students/${kai}/days/${TODAY}/complete`, {})
    const detail = await h.get(U.caseManager, `/students/${kai}/days/${TODAY}`)
    expect(detail.status).toBe(200)
    expect(detail.body.dataPoints).toEqual([])
    expect(detail.body.events).toHaveLength(1)
    expect(detail.body.dailySummary).toBeNull()
    const today = (await h.get(U.caseManager, `/students/${kai}/days`)).body.days.find((d: { date: string }) => d.date === TODAY)
    expect(today.counts).toMatchObject({ dataPoints: 0, events: 1 })
    for (const user of [U.parentKai, U.districtLead, U.schoolAdmin]) {
      expect((await h.get(user, `/students/${kai}/days`)).status, user).toBe(403)
      expect((await h.get(user, `/students/${kai}/days/${TODAY}`)).status, user).toBe(403)
    }
    expect((await h.get(U.ea, `/students/${amara}/days`)).status).toBe(403)
  })
})

describe('end-of-day review', () => {
  it('complete marks the day reviewed and drafts a daily summary that only the EA and teacher see', async () => {
    const h = createHarness()
    const objectiveId = await objectiveOf(h)
    await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId, count: 2, classId: null, lessonId: null })
    const done = await h.post(U.ea, `/students/${kai}/days/${TODAY}/complete`, { note: 'Good day overall.' })
    expect(done.status).toBe(200)
    expect(done.body.review).toMatchObject({ date: TODAY, completedBy: U.ea, note: 'Good day overall.' })
    expect(done.body.dailySummary).toMatchObject({ kind: 'daily', period: TODAY, status: 'draft' })

    const detail = await h.get(U.teacher, `/students/${kai}/days/${TODAY}`)
    expect(detail.body.review).toMatchObject({ completedBy: U.ea })
    expect(detail.body.dailySummary).toMatchObject({ id: done.body.dailySummary.id, status: 'draft' })
    expect((await h.get(U.ea, `/students/${kai}/days`)).body.days.find((d: { date: string }) => d.date === TODAY).reviewed).toBe(true)

    // Completing again keeps one daily summary (the draft is regenerated in place).
    const again = await h.post(U.teacher, `/students/${kai}/days/${TODAY}/complete`, {})
    expect(again.body.dailySummary.id).toBe(done.body.dailySummary.id)
    expect(again.body.review.version).toBe(2)

    // Once approved, completing again leaves it alone.
    const s = again.body.dailySummary
    await h.post(U.ea, `/summaries/${s.id}/approve`, { studentId: kai, version: s.version })
    const last = await h.post(U.ea, `/students/${kai}/days/${TODAY}/complete`, {})
    expect(last.body.dailySummary).toMatchObject({ id: s.id, status: 'approved' })
  })

  it('only the EA or teacher completes a day; a future day is refused', async () => {
    const h = createHarness()
    for (const user of [U.caseManager, U.parentKai, U.districtLead]) {
      expect((await h.post(user, `/students/${kai}/days/${TODAY}/complete`, {})).status).toBe(403)
    }
    expect((await h.post(U.ea, `/students/${amara}/days/${TODAY}/complete`, {})).status).toBe(403)
    expect((await h.post(U.ea, `/students/${kai}/days/2026-11-20/complete`, {})).status).toBe(400)
  })

  it('GET /me/day-review lists the helper\'s assigned students, unreviewed first', async () => {
    const h = createHarness()
    const objectiveId = await objectiveOf(h, sofia)
    await h.post(U.ea, `/students/${sofia}/events`, { kind: 'counter', objectiveId, count: 1, classId: null, lessonId: null })
    const before = await h.get(U.ea, '/me/day-review')
    expect(before.status).toBe(200)
    expect(before.body.date).toBe(TODAY)
    // The EA is assigned to Kai and Sofia, not Amara.
    expect(before.body.students.map((s: { studentId: string }) => s.studentId).sort()).toEqual([kai, sofia].sort())
    expect(before.body.students[0]).toMatchObject({ studentId: sofia, entriesToday: 1, reviewed: false })
    expect(before.body.students[0].label).toMatch(/^S-/)

    await h.post(U.ea, `/students/${sofia}/days/${TODAY}/complete`, {})
    const after = await h.get(U.ea, '/me/day-review')
    expect(after.body.students.at(-1)).toMatchObject({ studentId: sofia, reviewed: true })

    // The teacher sees every class student; the case manager, parent and district lead have no review.
    expect((await h.get(U.teacher, '/me/day-review')).body.students).toHaveLength(3)
    expect((await h.get(U.caseManager, '/me/day-review')).body.students).toEqual([])
    expect((await h.get(U.parentKai, '/me/day-review')).body.students).toEqual([])
    expect((await h.get(U.districtLead, '/me/day-review')).body.students).toEqual([])
  })
})

describe('review queue shows and confirms own captures only', () => {
  it('a teacher does not see or confirm the EA\'s pending score', async () => {
    const h = createHarness()
    const objectiveId = await objectiveOf(h)
    runStudent(
      h.studentSql(kai),
      'dataPoints.addPending',
      { studentId: kai, objectiveId, value: 5, aiConfidence: 0.2, routing: { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: 'photo:captures/1/page.png#q1', now: new Date(h.clock.now).toISOString() },
      ACTORS.ea,
    )
    const mine = await h.get(U.ea, '/review-queue')
    expect(mine.body.items).toHaveLength(1)
    const item = mine.body.items[0].item
    expect((await h.get(U.teacher, '/review-queue')).body.items).toEqual([])
    expect((await h.post(U.teacher, `/review-queue/${item.id}/confirm?studentId=${kai}`, { expectedVersion: item.version })).status).toBe(403)
    expect((await h.get(U.caseManager, '/review-queue')).status).toBe(403)
    expect((await h.post(U.ea, `/review-queue/${item.id}/confirm?studentId=${kai}`, { expectedVersion: item.version })).status).toBe(200)
  })
})
