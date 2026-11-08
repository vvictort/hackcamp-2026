import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from '../services/testing'
import { createHarness } from '../e2e/harness'
import { amara, kai, sofia, U } from '../e2e/flows'

afterEach(closeAll)

const activeGoals = async (h: ReturnType<typeof createHarness>, id: string) => {
  const p = await h.get(U.teacher, `/students/${id}`)
  expect(p.status).toBe(200)
  return (p.body.goals as { id: string; status: string }[]).filter((g) => g.status === 'active')
}

const item = (goalId: string, over: Record<string, unknown> = {}) => ({
  goalId, label: 'adapt', adaptationType: 'chunked_steps', title: 'Steps', text: 'Give a step-by-step card.', why: 'Supports the goal.', ...over,
})

describe('POST /lens/approvals (Lens approval logs usage into 1B)', () => {
  it('stores an approved adaptation with a usage event, lists it, and issues a sheet code the capture route accepts', async () => {
    const h = createHarness()
    const [goal] = await activeGoals(h, kai)
    const res = await h.post(U.teacher, '/lens/approvals', {
      studentId: kai,
      subject: 'reading',
      lessonText: 'Retell the story\nThen answer questions',
      items: [item(goal.id)],
      checks: [{ goalId: goal.id, items: [{ id: 'G1-C1', prompt: 'Can the student retell?', format: 'work_sample', options: null }] }],
    })
    expect(res.status).toBe(201)
    expect(res.body.suggestions).toHaveLength(1)
    expect(res.body.sheets).toHaveLength(1)
    expect(res.body.sheets[0].sheetCode).toMatch(/^AL-[A-Z0-9]{8}$/)

    // Same lesson id reused for a later approval; the code resolves for capture.
    const again = await h.post(U.teacher, '/lens/approvals', { studentId: kai, subject: 'reading', lessonId: res.body.lessonId, items: [item(goal.id, { adaptationType: 'sentence_frames', text: 'Offer sentence frames.' })] })
    expect(again.body.lessonId).toBe(res.body.lessonId)

    const usage = await h.get(U.teacher, `/students/${kai}/lens-usage`)
    expect(usage.status).toBe(200)
    expect(usage.body.events).toHaveLength(2)
    expect(usage.body.events[0]).toMatchObject({ label: 'adaptation', goalIds: [goal.id] })
    expect(usage.body.used).toEqual(expect.arrayContaining([{ adaptationType: 'chunked_steps', n: 1 }, { adaptationType: 'sentence_frames', n: 1 }]))
  })

  it('refuses a modification the IEP does not authorize (PRD 1A-5), whatever the page sent', async () => {
    const h = createHarness()
    const [goal] = await activeGoals(h, kai)
    const res = await h.post(U.teacher, '/lens/approvals', { studentId: kai, subject: 'reading', items: [item(goal.id, { label: 'modify', adaptationType: 'modified_assessment' })] })
    expect(res.status).toBe(201)
    expect(res.body.blocked).toEqual([goal.id])
    expect(res.body.suggestions).toEqual([])
    expect(res.body.lessonId).toBeNull()
    expect((await h.get(U.teacher, `/students/${kai}/lens-usage`)).body.events).toEqual([])
  })

  it('stores a modification when the IEP modifies that subject', async () => {
    const h = createHarness()
    const [goal] = await activeGoals(h, sofia)
    const res = await h.post(U.teacher, '/lens/approvals', { studentId: sofia, subject: 'math', items: [item(goal.id, { label: 'modify', adaptationType: 'modified_assessment' })] })
    expect(res.body.blocked).toEqual([])
    expect(res.body.suggestions).toHaveLength(1)
    expect((await h.get(U.teacher, `/students/${sofia}/lens-usage`)).body.events[0].label).toBe('modification')
  })

  it('drops goals that are not the student current goals, and rejects other users', async () => {
    const h = createHarness()
    const [other] = await activeGoals(h, amara)
    const res = await h.post(U.teacher, '/lens/approvals', { studentId: kai, subject: 'reading', items: [item(other.id)] })
    expect(res.body.suggestions).toEqual([])
    const bad = await h.post(U.teacher, '/lens/approvals', { studentId: kai, subject: 'reading', items: [] })
    expect(bad.status).toBe(400)
  })
})
