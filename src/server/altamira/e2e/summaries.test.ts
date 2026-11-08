import { afterEach, describe, expect, it } from 'vitest'
import { ACTORS, closeAll, runStudent } from '../services/testing'
import { kai, TODAY, U } from './flows'
import { createHarness, type Harness } from './harness'

afterEach(closeAll)

const KINDS = [
  { kind: 'daily', period: TODAY },
  { kind: 'weekly', period: '2026-W46' },
  { kind: 'monthly', period: '2026-10' },
] as const

type S = { id: string; version: number; status: string; kind: string; period: string; text: string; translatedText: string | null; language: string | null }

const generate = async (h: Harness, user: string, kind: string, period: string) => {
  const res = await h.post(user, `/students/${kai}/summaries/generate`, { kind, period })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.summary as S
}
const seen = async (h: Harness, user: string, path = `/students/${kai}/summaries`) => ((await h.get(user, path)).body.summaries as S[]).map((s) => s.id)

describe.each(KINDS)('AI approval rule: $kind summary', ({ kind, period }) => {
  it('is a draft that only the EA and teacher can see, edit and approve', async () => {
    const h = createHarness()
    const draft = await generate(h, U.ea, kind, period)
    expect(draft).toMatchObject({ kind, period, status: 'draft' })

    // Visible to the EA and the teacher; invisible to the case manager, the parent and the district lead.
    expect(await seen(h, U.ea)).toEqual([draft.id])
    expect(await seen(h, U.teacher)).toEqual([draft.id])
    expect(await seen(h, U.caseManager)).toEqual([])
    expect(await seen(h, U.parentKai, `/family/${kai}/summaries`)).toEqual([])
    expect((await h.get(U.districtLead, `/students/${kai}/summaries`)).status).toBe(403)
    expect((await h.get(U.districtLead, `/family/${kai}/summaries`)).status).toBe(403)
    expect((await h.get(U.caseManager, '/me/weekly')).body.summaries).toEqual([])

    // Nobody else edits, approves or regenerates it.
    for (const user of [U.caseManager, U.parentKai, U.districtLead, U.schoolAdmin]) {
      expect((await h.call(user, 'PATCH', `/summaries/${draft.id}`, { studentId: kai, text: 'Changed.', version: draft.version })).status, `patch ${user}`).toBe(403)
      expect((await h.post(user, `/summaries/${draft.id}/approve`, { studentId: kai, version: draft.version })).status, `approve ${user}`).toBe(403)
      expect((await h.post(user, `/students/${kai}/summaries/generate`, { kind, period })).status, `generate ${user}`).toBe(403)
    }
    expect(await seen(h, U.ea)).toEqual([draft.id])
    expect((await h.get(U.ea, `/students/${kai}/summaries`)).body.summaries[0]).toMatchObject({ status: 'draft', text: draft.text })
  })

  it.each([{ approver: 'ea' as const }, { approver: 'teacher' as const }])('the $approver approves, then only its audience sees it', async ({ approver }) => {
    const h = createHarness()
    const draft = await generate(h, U.ea, kind, period)
    const approved = await h.post(U[approver], `/summaries/${draft.id}/approve`, { studentId: kai, version: draft.version })
    expect(approved.status).toBe(200)
    expect(approved.body.summary).toMatchObject({ status: 'approved', approvedBy: U[approver] })
    // Approving twice, or with a stale version, is refused.
    expect((await h.post(U.ea, `/summaries/${draft.id}/approve`, { studentId: kai, version: draft.version })).status).toBe(409)
    expect((await h.post(U.ea, `/summaries/${draft.id}/approve`, { studentId: kai, version: approved.body.summary.version })).status).toBe(400)

    const cm = await seen(h, U.caseManager)
    const parent = await seen(h, U.parentKai, `/family/${kai}/summaries`)
    expect(cm).toEqual(kind === 'weekly' ? [draft.id] : [])
    expect(parent).toEqual(kind === 'monthly' ? [draft.id] : [])
    expect(((await h.get(U.caseManager, '/me/weekly')).body.summaries as { id: string }[]).map((s) => s.id)).toEqual(kind === 'weekly' ? [draft.id] : [])
    // Whoever sees it sees no user ids.
    if (kind !== 'daily') {
      const view = kind === 'weekly' ? (await h.get(U.caseManager, `/students/${kai}/summaries`)).body.summaries[0] : (await h.get(U.parentKai, `/family/${kai}/summaries`)).body.summaries[0]
      expect(view).toMatchObject({ editedBy: null, approvedBy: null })
    }
  })

  it('editing an approved summary returns it to draft and hides it again', async () => {
    const h = createHarness()
    const draft = await generate(h, U.ea, kind, period)
    const approved = (await h.post(U.teacher, `/summaries/${draft.id}/approve`, { studentId: kai, version: draft.version })).body.summary as S
    const edited = await h.call(U.ea, 'PATCH', `/summaries/${draft.id}`, { studentId: kai, text: 'A fictional edit by the EA.', version: approved.version })
    expect(edited.status).toBe(200)
    expect(edited.body.summary).toMatchObject({ status: 'draft', approvedBy: null, approvedAt: null, editedBy: U.ea, text: 'A fictional edit by the EA.' })
    expect(await seen(h, U.caseManager)).toEqual([])
    expect(await seen(h, U.parentKai, `/family/${kai}/summaries`)).toEqual([])
    expect(await seen(h, U.teacher)).toEqual([draft.id])
    // A stale version is a conflict.
    expect((await h.call(U.ea, 'PATCH', `/summaries/${draft.id}`, { studentId: kai, text: 'Again.', version: approved.version })).status).toBe(409)
    // Regenerating an approved summary is refused; a draft is regenerated in place.
    const re = await h.post(U.ea, `/students/${kai}/summaries/generate`, { kind, period })
    expect(re.status).toBe(201)
    expect(re.body.summary.id).toBe(draft.id)
    expect((await h.get(U.ea, `/students/${kai}/summaries?kind=${kind}`)).body.summaries).toHaveLength(1)
  })
})

describe('regenerating', () => {
  it('refuses to overwrite an approved summary', async () => {
    const h = createHarness()
    const draft = await generate(h, U.ea, 'monthly', '2026-10')
    await h.post(U.ea, `/summaries/${draft.id}/approve`, { studentId: kai, version: draft.version })
    expect((await h.post(U.ea, `/students/${kai}/summaries/generate`, { kind: 'monthly', period: '2026-10' })).status).toBe(400)
  })

  it('rejects a period that does not fit the kind', async () => {
    const h = createHarness()
    expect((await h.post(U.ea, `/students/${kai}/summaries/generate`, { kind: 'weekly', period: '2026-10' })).status).toBe(400)
    expect((await h.post(U.ea, `/students/${kai}/summaries/generate`, { kind: 'quarterly' })).status).toBe(400)
  })
})

describe('monthly summary for the parent', () => {
  it('shows the approved translation and plays only approved text; the parent cannot generate, edit or approve', async () => {
    const h = createHarness()
    const draft = await generate(h, U.ea, 'monthly', '2026-10')
    const fixed = await h.call(U.teacher, 'PATCH', `/summaries/${draft.id}`, {
      studentId: kai,
      text: draft.text,
      translatedText: 'Un resumen ficticio del mes.',
      language: 'es',
      version: draft.version,
    })
    expect(fixed.body.summary).toMatchObject({ language: 'es', translatedText: 'Un resumen ficticio del mes.', audioScript: 'Un resumen ficticio del mes.' })
    // The draft translation and audio script are not playable by the parent yet.
    expect((await h.post(U.parentKai, '/tts', { text: 'Un resumen ficticio del mes.', language: 'es', studentId: kai })).status).toBe(403)
    await h.post(U.ea, `/summaries/${draft.id}/approve`, { studentId: kai, version: fixed.body.summary.version })

    const parent = await h.get(U.parentKai, `/family/${kai}/summaries`)
    expect(parent.body.summaries).toHaveLength(1)
    expect(parent.body.summaries[0]).toMatchObject({ kind: 'monthly', language: 'es', translatedText: 'Un resumen ficticio del mes.' })
    expect((await h.post(U.parentKai, '/tts', { text: 'Un resumen ficticio del mes.', language: 'es', studentId: kai })).status).toBe(204)
    expect((await h.get(U.parentSofia, `/family/${kai}/summaries`)).status).toBe(403)
    expect((await h.post(U.parentKai, `/students/${kai}/summaries/generate`, { kind: 'monthly' })).status).toBe(403)
  })
})

describe('summary inputs exclude unconfirmed data', () => {
  it('an unreviewed AI score does not reach the daily summary until it is confirmed', async () => {
    const h = createHarness()
    const objectiveId = (await h.get(U.ea, `/students/${kai}/capture-objectives`)).body.objectives[0].objectiveId as string
    await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId, count: 2, classId: null, lessonId: null })
    runStudent(
      h.studentSql(kai),
      'dataPoints.addPending',
      { studentId: kai, objectiveId, value: 99, aiConfidence: 0.2, routing: { status: 'pending_review', reviewKind: 'low_confidence' }, sourceRef: 'photo:captures/1/page.png#q1', now: new Date(h.clock.now).toISOString() },
      ACTORS.ea,
    )
    const draft = await generate(h, U.ea, 'daily', TODAY)
    expect(draft.text).toContain('1 confirmed entry')
    expect(draft.text).not.toContain('99')

    // Once the EA confirms it, a regenerated draft includes it.
    const queue = await h.get(U.ea, '/review-queue')
    const item = queue.body.items[0]
    expect((await h.post(U.ea, `/review-queue/${item.item.id}/confirm?studentId=${kai}`, { expectedVersion: item.item.version })).status).toBe(200)
    const again = await generate(h, U.ea, 'daily', TODAY)
    expect(again.text).toContain('2 confirmed entries')
  })
})

describe('pending list and weekly list', () => {
  it('lists drafts across the EA/teacher students and approved weekly summaries for the case manager', async () => {
    const h = createHarness()
    const weekly = await generate(h, U.ea, 'weekly', '2026-W46')
    const monthly = await generate(h, U.teacher, 'monthly', '2026-10')
    for (const user of [U.ea, U.teacher]) {
      const pending = (await h.get(user, '/me/summaries/pending')).body.summaries as { id: string; studentId: string; label: string; kind: string; period: string }[]
      expect(pending.map((p) => p.id).sort()).toEqual([weekly.id, monthly.id].sort())
      expect(pending[0]).toMatchObject({ studentId: kai })
      expect(pending[0].label).toMatch(/^S-/)
    }
    for (const user of [U.caseManager, U.parentKai, U.districtLead]) {
      const res = await h.get(user, '/me/summaries/pending')
      expect(res.status === 403 || (res.body.summaries as unknown[]).length === 0).toBe(true)
    }
    await h.post(U.ea, `/summaries/${weekly.id}/approve`, { studentId: kai, version: weekly.version })
    const list = (await h.get(U.caseManager, '/me/weekly')).body.summaries
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: weekly.id, studentId: kai, period: '2026-W46' })
    expect((await h.get(U.ea, '/me/summaries/pending')).body.summaries.map((p: { id: string }) => p.id)).toEqual([monthly.id])
  })
})
