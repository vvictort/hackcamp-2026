import { afterEach, describe, expect, it } from 'vitest'
import { CBIEP_SAMPLE_TEXT, CLASS_IDS, SCHOOL } from '../fixtures'
import { closeAll } from './testing'
import { amara, approvedMathSheets, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('permission matrix enforced on the API (PRD NFR Security)', () => {
  it('refuses an IEP import by a teacher, an EA or a parent with 403', async () => {
    const h = createHarness()
    for (const user of [U.teacher, U.ea, U.parentKai, U.schoolAdmin, U.districtLead]) {
      const res = await h.post(user, `/students/${kai}/iep/import`, { sourceKind: 'text', text: CBIEP_SAMPLE_TEXT })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('forbidden')
    }
    expect(h.studentSql(kai).get<{ n: number }>('SELECT COUNT(*) AS n FROM iep_versions')?.n).toBe(1)
    expect(h.aiCalls.proposeObjectives).toBe(0)
  })

  it('an EA cannot see a student who is not assigned to them', async () => {
    const h = createHarness()
    expect((await h.get(U.ea, `/students/${kai}`)).status).toBe(200)
    for (const path of [`/students/${amara}`, `/students/${amara}/timeline`, `/students/${amara}/objectives`]) {
      expect((await h.get(U.ea, path)).status).toBe(403)
    }
  })

  it('a parent cannot see another child', async () => {
    const h = createHarness()
    expect((await h.get(U.parentKai, `/family/${kai}/summaries`)).status).toBe(200)
    expect((await h.get(U.parentKai, `/family/${amara}/summaries`)).status).toBe(403)
    expect((await h.get(U.parentKai, `/students/${sofia}/timeline`)).status).toBe(403)
  })

  it('I2: an EA opens the IEP of assigned students only, a teacher those of their classes only', async () => {
    const h = createHarness()
    expect((await h.get(U.ea, `/students/${kai}`)).status).toBe(200)
    expect((await h.get(U.ea, `/students/${sofia}`)).status).toBe(200)
    const unassigned = await h.get(U.ea, `/students/${amara}`)
    expect(unassigned.status).toBe(403)
    expect(unassigned.body.error.code).toBe('forbidden')
    expect((await h.get(U.teacher, `/students/${amara}`)).status).toBe(200)
    // A teacher whose only class does not include Amara gets 403 for her.
    const grant = await h.post(U.schoolAdmin, `/admin/schools/${SCHOOL.id}/memberships`, { kind: 'membership', userId: 'teacher-pe', displayName: 'Fictional PE Teacher', role: 'teacher', classId: CLASS_IDS.pe })
    expect(grant.status).toBe(200)
    expect((await h.get('teacher-pe', `/students/${kai}`)).status).toBe(200)
    expect((await h.get('teacher-pe', `/students/${amara}`)).status).toBe(403)
    expect((await h.get('teacher-pe', `/students/${sofia}`)).status).toBe(403)
  })

  it('the case manager has no direct IEP edit: only import and confirm remain, the rest is 403 or gone', async () => {
    const h = createHarness()
    expect((await h.post(U.caseManager, `/students/${kai}/events`, { kind: 'counter', objectiveId: 'x', count: 1 })).status).toBe(403)
    expect((await h.get(U.caseManager, '/review-queue')).status).toBe(403)
    expect((await h.post(U.caseManager, `/data-points/x/correct?studentId=${kai}`, { expectedVersion: 1, value: 1, reason: 'x' })).status).toBe(403)
    expect((await h.call(U.caseManager, 'PUT', `/family/${kai}/consents`, { kind: 'video', granted: true })).status).toBe(403)
    expect((await h.post(U.caseManager, `/summaries/x/approve`, { studentId: kai, version: 1 })).status).toBe(403)
  })

  it('C5: the review queue and corrections are for the EA and teacher who captured the entry', async () => {
    const h = createHarness({ devSeed: true, ai: { scorePhotoPage: async (input) => ({ sheetCode: null, items: input.check.items.map((i) => ({ itemId: i.id, value: 1, confidence: 0.3 })) }) } })
    const { sheets } = await approvedMathSheets(h, sofia)
    const batch = await h.post(U.teacher, '/captures/photos', { pages: [{ fileKey: `captures/sheet-code-${sheets.pages[0].sheetCode}.jpg`, contentType: 'image/jpeg' }] })
    const dataPointId = batch.body.batch.pages[0].dataPointIds[0]
    const mine = await h.get(U.teacher, '/review-queue')
    const entry = mine.body.items.find((i: { dataPoint: { id: string } }) => i.dataPoint.id === dataPointId)
    expect(entry).toBeDefined()
    // The EA of the same student sees the queue but not the teacher's capture.
    const eaQueue = await h.get(U.ea, '/review-queue')
    expect(eaQueue.status).toBe(200)
    expect(eaQueue.body.items.some((i: { dataPoint: { id: string } }) => i.dataPoint.id === dataPointId)).toBe(false)
    // Not theirs: confirm and correct are refused.
    expect((await h.post(U.ea, `/review-queue/${entry.item.id}/confirm?studentId=${sofia}`, { expectedVersion: entry.item.version })).status).toBe(403)
    expect((await h.post(U.ea, `/data-points/${dataPointId}/correct?studentId=${sofia}`, { expectedVersion: 1, value: 0, reason: 'not mine' })).status).toBe(403)
    // The case manager and the parent are refused outright.
    expect((await h.get(U.caseManager, '/review-queue')).status).toBe(403)
    expect((await h.get(U.parentSofia, '/review-queue')).status).toBe(403)
    expect((await h.post(U.caseManager, `/review-queue/${entry.item.id}/confirm?studentId=${sofia}`, { expectedVersion: entry.item.version })).status).toBe(403)
    // The capturing teacher confirms.
    expect((await h.post(U.teacher, `/review-queue/${entry.item.id}/confirm?studentId=${sofia}`, { expectedVersion: entry.item.version })).status).toBe(200)
  })

  it('the EA can reach the review queue, with their own captures', async () => {
    const h = createHarness()
    const objectives = (await h.get(U.ea, `/students/${kai}/capture-objectives`)).body.objectives
    expect((await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId: objectives[0].objectiveId, count: 1 })).status).toBe(201)
    expect((await h.get(U.ea, '/review-queue')).status).toBe(200)
  })

  it('voice notes need the parent\'s consent (403 consent_required)', async () => {
    const h = createHarness()
    const res = await h.post(U.teacher, `/students/${amara}/voice-notes`, { audio: { fileKey: 'ea/amara.webm', contentType: 'audio/webm' } })
    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain('consent_required')
  })

  it('district lead and school admin reach no student data', async () => {
    const h = createHarness()
    for (const user of [U.districtLead, U.schoolAdmin]) {
      for (const path of [`/students/${kai}`, `/students/${kai}/timeline`, `/students/${kai}/summaries`, `/students/${kai}/objectives`]) {
        expect((await h.get(user, path)).status, `${user} ${path}`).toBe(403)
      }
    }
  })

  it('GET /admin/schools/:id/memberships is for the school administrator only', async () => {
    const h = createHarness()
    const ok = await h.get(U.schoolAdmin, `/admin/schools/${SCHOOL.id}/memberships`)
    expect(ok.status).toBe(200)
    expect(ok.body.memberships.length).toBeGreaterThan(5)
    expect(Object.keys(ok.body.memberships[0]).sort()).toEqual(['classId', 'displayName', 'role', 'studentId', 'userId'])
    for (const user of [U.caseManager, U.teacher, U.ea, U.parentKai, U.districtLead]) {
      expect((await h.get(user, `/admin/schools/${SCHOOL.id}/memberships`)).status).toBe(403)
    }
    expect((await h.get(U.schoolAdmin, '/admin/schools/not-this-school/memberships')).status).toBe(403)
  })

  it('needs sign-in, validates bodies, and hides dev seed unless enabled', async () => {
    const h = createHarness()
    expect((await h.get(null, '/me')).status).toBe(401)
    const me = await h.get(U.caseManager, '/me')
    expect(me.status).toBe(200)
    const bad = await h.post(U.teacher, `/students/${kai}/events`, { kind: 'prompt_level' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('bad_request')
    expect((await h.post(U.schoolAdmin, '/dev/seed')).status).toBe(404)
    const unknown = await h.get(U.caseManager, '/no-such-route')
    expect(unknown).toEqual({ status: 404, body: { error: { code: 'not_found', message: 'Unknown Altamyra route' } } })
  })

  it('POST /dev/seed loads the fictional fixtures when ALTAMYRA_DEV_SEED is on', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    expect((await h.get(U.caseManager, '/me')).body.caseload ?? []).toHaveLength(0)
    const seeded = await h.post(U.schoolAdmin, '/dev/seed')
    expect(seeded.status).toBe(200)
    expect(seeded.body.studentIds.sort()).toEqual([kai, amara, sofia].sort())
    expect((await h.get(U.caseManager, `/students/${kai}`)).status).toBe(200)
  })
})
