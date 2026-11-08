import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('deepspace', () => ({ getAuthToken: vi.fn(async () => 'tok') }))

import { localDate } from '@/lib/utils'
import { PlanConflictError, acceptedChanges, approvePlan, canApprove, createPlan, editChange, getStudentPlans, missingPlan, pickPlan, titleFromText, toggleChange, updatePlan, type LessonPlan } from './plans-api'

const plan = (o: Partial<LessonPlan>): LessonPlan => ({ id: 'p', studentId: 's', date: '2026-11-08', title: 't', originalText: 'o', proposed: [], tailoredText: 'x', status: 'draft', approvedBy: null, approvedAt: null, version: 1, ...o })

function mockFetch(body: unknown = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

describe('plans-api helpers', () => {
  it('formats the local date', () => expect(localDate(new Date(2026, 10, 8, 23, 30))).toBe('2026-11-08'))
  it('prefers the approved plan, then newest version', () => {
    expect(pickPlan([])).toBeNull()
    expect(pickPlan([plan({ id: 'a', version: 3 }), plan({ id: 'b', version: 1, status: 'approved' })])?.id).toBe('b')
    expect(pickPlan([plan({ id: 'a', version: 1 }), plan({ id: 'b', version: 2 })])?.id).toBe('b')
  })
  it('finds students without a plan', () => {
    const m = missingPlan({ date: 'd', students: [{ studentId: 'a', label: 'A', plan: null }, { studentId: 'b', label: 'B', plan: { id: 'p', title: 't', status: 'draft' } }] })
    expect([...m]).toEqual(['a'])
    expect(missingPlan(null).size).toBe(0)
  })
  it('toggles and edits one change', () => {
    const l = [{ id: '1', text: 'a', accepted: true }, { id: '2', text: 'b', accepted: true }]
    expect(toggleChange(l, '2')[1].accepted).toBe(false)
    expect(editChange(l, '1', 'z')[0].text).toBe('z')
    expect(acceptedChanges(toggleChange(l, '2')).map((c) => c.id)).toEqual(['1'])
  })
  it('only approves a non-empty draft', () => {
    expect(canApprove(plan({}))).toBe(true)
    expect(canApprove(plan({ tailoredText: '  ' }))).toBe(false)
    expect(canApprove(plan({ status: 'approved' }))).toBe(false)
  })
  it('titles from the first line', () => {
    expect(titleFromText('\n  Fractions \nmore', 'fb')).toBe('Fractions')
    expect(titleFromText('', 'fb')).toBe('fb')
    expect(titleFromText('x'.repeat(80), 'fb')).toHaveLength(60)
  })
})

describe('plans-api calls', () => {
  it('sends the right requests', async () => {
    const f = mockFetch({ plans: [] })
    await getStudentPlans('s/1', '2026-11-08')
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/students/s%2F1/lesson-plans?date=2026-11-08')
    await createPlan('s1', { title: 't', text: 'x' })
    await updatePlan('p1', 's1', 2, { tailoredText: 'n' })
    await approvePlan('p1', 's1', 3)
    const calls = f.mock.calls as unknown as [string, RequestInit][]
    expect(calls[1][1].method).toBe('POST')
    expect(calls[2][0]).toBe('/api/v1/lesson-plans/p1')
    expect(calls[2][1].method).toBe('PATCH')
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ studentId: 's1', version: 2, tailoredText: 'n' })
    expect(calls[3][0]).toBe('/api/v1/lesson-plans/p1/approve')
    expect(JSON.parse(String(calls[3][1].body))).toEqual({ studentId: 's1', version: 3 })
  })
})

describe('createPlan conflict', () => {
  it('surfaces 409 as a typed conflict with the server message', async () => {
    const msg = 'This student already has a plan for that day. Edit it instead.'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'version_conflict', message: msg } }), { status: 409, headers: { 'content-type': 'application/json' } })))
    const err = await createPlan('s1', { title: 't', text: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlanConflictError)
    expect((err as PlanConflictError).message).toBe(msg)
    expect((err as PlanConflictError).code).toBe('version_conflict')
  })
  it('leaves other errors untyped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const err = await createPlan('s1', { title: 't', text: 'x' }).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(PlanConflictError)
  })
})
