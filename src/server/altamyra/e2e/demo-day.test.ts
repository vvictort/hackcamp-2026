import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_IEP_SD23_TEXT, DEMO_PARENT, DISTRICT, USER_IDS } from '../fixtures'
import { parseCbIepText } from '../routes/cbiep'
import { closeAll } from '../services/testing'
import { createHarness } from './harness'

afterEach(closeAll)

const CALLER = 'demo-user-1'
const docs = import.meta.glob<string>('../../../../docs/demo/sample-iep-sd23.txt', { query: '?raw', import: 'default', eager: true })

describe('POST /dev/demo-day', () => {
  it('404s without the dev flag and without sign-in', async () => {
    const off = createHarness({ seed: false })
    expect((await off.post(CALLER, '/dev/demo-day')).status).toBe(404)
    const on = createHarness({ seed: false, devSeed: true })
    expect((await on.post(null, '/dev/demo-day')).status).toBe(401)
  })

  it('cannot be driven from outside: a client header names no user', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    const res = await h.post(null, '/dev/demo-day', {}, { 'x-test-user': '', 'x-altamyra-internal': USER_IDS.caseManager })
    expect(res.status).toBe(401)
  })

  it('the sample IEP reads cleanly and the docs file is the same text', () => {
    expect(Object.values(docs)).toEqual([DEMO_IEP_SD23_TEXT])
    const sections = parseCbIepText(DEMO_IEP_SD23_TEXT)
    expect(sections.student).toMatchObject({ firstName: 'Simran', lastName: 'Grewal', grade: '3' })
    expect(sections.profile.designation).toContain('Category G')
    expect(sections.goals).toHaveLength(4)
    expect(sections.reviewDate).toBe('2027-06-10')
  })

  it('runs a whole school day through the real routes, every step ok, and every role sees its data', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    const res = await h.post(CALLER, '/dev/demo-day')
    expect(res.status).toBe(200)
    const { studentId, steps } = res.body as { studentId: string; steps: { role: string; action: string; ok: boolean; detail: string; page: string }[] }
    expect(steps.filter((s) => !s.ok), JSON.stringify(steps.filter((s) => !s.ok))).toEqual([])
    expect(steps.length).toBeGreaterThanOrEqual(25)
    for (const role of ['parent', 'case_manager', 'teacher', 'ea', 'school_admin', 'district_lead']) expect(steps.some((s) => s.role === role)).toBe(true)
    expect(steps.every((s) => s.page.startsWith('/'))).toBe(true)

    // The AI approval rule step ran and passed.
    expect(steps.find((s) => s.action === 'Check the AI approval rule')).toMatchObject({ ok: true, role: 'parent' })
    // The monthly summary reached the parent translated, with an audio script.
    const parent = await h.get(DEMO_PARENT.id, `/family/${studentId}/summaries`)
    expect(parent.status).toBe(200)
    expect(parent.body.summaries).toHaveLength(1)
    expect(parent.body.summaries[0]).toMatchObject({ kind: 'monthly', status: 'approved', language: 'pa' })
    expect(parent.body.summaries[0].translatedText).toBeTruthy()
    expect(parent.body.summaries[0].audioScript).toBeTruthy()
    expect((await h.get(DEMO_PARENT.id, '/me')).body.parentOf).toEqual([studentId])

    // Case manager: confirmed IEP, version 2 after the ticket, four goals with the four metric kinds, an approved weekly summary.
    const profile = await h.get(USER_IDS.caseManager, `/students/${studentId}`)
    expect(profile.body.iepVersion).toBe(2)
    expect(profile.body.sections.accommodations).toContain('Offer a choice of two seats during group activities.')
    const objectives = (await h.get(USER_IDS.caseManager, `/students/${studentId}/objectives`)).body.objectives as { metricType: string; status: string }[]
    expect(objectives.every((o) => o.status === 'confirmed')).toBe(true)
    expect(new Set(objectives.map((o) => o.metricType))).toEqual(new Set(['accuracy', 'prompt_level', 'frequency', 'duration']))
    expect(((await h.get(USER_IDS.caseManager, '/me/weekly')).body.summaries as { studentId: string }[]).some((s) => s.studentId === studentId)).toBe(true)
    expect((await h.get(USER_IDS.caseManager, `/students/${studentId}/days`)).body.days.length).toBeGreaterThan(0)

    // Teacher and EA: the approved plan, the daily summary, the day record, an empty review queue.
    const plans = (await h.get(USER_IDS.ea, `/students/${studentId}/lesson-plans`)).body.plans as { status: string; title: string }[]
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ status: 'approved', title: 'The life cycle of a salmon' })
    const kinds = ((await h.get(USER_IDS.teacher, `/students/${studentId}/summaries`)).body.summaries as { kind: string; status: string }[]).map((s) => `${s.kind}:${s.status}`).sort()
    expect(kinds).toEqual(['daily:approved', 'monthly:approved', 'weekly:approved'])
    const day = await h.get(USER_IDS.ea, `/me/day-review`)
    expect(day.body.students.find((s: { studentId: string }) => s.studentId === studentId)).toMatchObject({ reviewed: true })
    expect(((await h.get(USER_IDS.ea, '/review-queue')).body.items as { studentId: string }[]).filter((i) => i.studentId === studentId)).toEqual([])

    // School admin: no ticket left waiting. District lead: anonymized read works.
    expect(((await h.get(USER_IDS.schoolAdmin, '/tickets?status=pending')).body.tickets as { studentId: string }[]).filter((t) => t.studentId === studentId)).toEqual([])
    expect((await h.get(USER_IDS.districtLead, `/districts/${DISTRICT.id}/insights`)).status).toBe(200)

    // The caller keeps a role and now sees the new student in their app.
    const me = await h.get(CALLER, '/me')
    expect(me.body.students.map((s: { id: string }) => s.id)).toContain(studentId)
    expect((await h.get(CALLER, '/dev/roles')).body.active).toBe('case_manager')

    // Nothing the AI saw named the student or the parent.
    expect(JSON.stringify(h.aiRequests)).not.toMatch(/Simran|Grewal|Gurpreet|Dhillon|FICT-000-123/)
    expect(h.errors).toEqual([])
  })

  it('a second run adds a second student and still passes', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    const a = await h.post(CALLER, '/dev/demo-day')
    const b = await h.post(CALLER, '/dev/demo-day')
    expect(b.body.studentId).not.toBe(a.body.studentId)
    expect((b.body.steps as { ok: boolean }[]).filter((s) => !s.ok)).toEqual([])
  })
})
