import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_NAMES } from '../fixtures'
import { closeAll } from '../services/testing'
import { approvedMathSheets, createLesson, kai, runLens, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('M1 lesson augmentation through /api/v1', () => {
  it('upload -> one cached analysis -> lens for the 3 IEP students in the class', async () => {
    const h = createHarness()
    const lesson = await createLesson(h, 'literacy')
    expect(h.aiCalls.analyseLesson).toBe(1)

    const analysis = await h.get(U.teacher, `/lessons/${lesson.id}/analysis`)
    expect(analysis.status).toBe(200)
    expect(analysis.body.analysis.lessonId).toBe(lesson.id)

    const lens = await runLens(h, lesson.id)
    expect(lens.analysisId).toBe(analysis.body.analysis.id)
    expect(lens.results).toHaveLength(3)
    // PRD 1A-2: the analysis is reused for every student and every later request.
    expect(h.aiCalls.analyseLesson).toBe(1)
    expect(h.aiCalls.lensForStudent).toBe(3)
    for (const r of lens.results) {
      const adaptations = r.suggestions.filter((s) => s.kind === 'adaptation')
      expect(adaptations.length).toBeGreaterThan(0)
      // PRD 1A-4: every adaptation is tagged to an IEP goal.
      for (const a of adaptations) expect(a.goalIds.length).toBeGreaterThan(0)
    }
  })

  it('one analysis call across 4 lens runs, and the teacher can remove a check (PRD 1A-2, 1A-6)', async () => {
    const h = createHarness()
    const lesson = await createLesson(h, 'literacy')
    const first = await runLens(h, lesson.id)
    const again = await h.post(U.teacher, `/lessons/${lesson.id}/lens`, { studentIds: [kai] })
    expect(again.status).toBe(200)
    expect(h.aiCalls.lensForStudent).toBe(4)
    expect(h.aiCalls.analyseLesson).toBe(1)

    const check = again.body.results[0].checks[0]
    expect(check).toBeDefined()
    const removed = await h.post(U.teacher, `/checks/${check.id}/remove?studentId=${kai}`, { expectedVersion: check.version })
    expect(removed.status).toBe(200)
    expect(removed.body.check.status).toBe('removed')
    const view = await h.get(U.teacher, `/lessons/${lesson.id}/lens/${kai}`)
    expect(view.body.checks.map((c: { id: string }) => c.id)).not.toContain(check.id)
    expect((await h.post(U.ea, `/checks/${check.id}/remove?studentId=${kai}`, { expectedVersion: 2 })).status).toBe(403)
    expect(first.results).toHaveLength(3)
  })

  it('blocks a modification the IEP does not authorize and allows Sofia’s authorized math modification', async () => {
    const h = createHarness()
    const lesson = await createLesson(h, 'numeracy')
    const lens = await runLens(h, lesson.id)
    expect(lens.results.map((r) => r.studentId).sort()).toEqual([kai, sofia].sort())

    const kaiMods = lens.results.find((r) => r.studentId === kai)!.suggestions.filter((s) => s.label === 'modification')
    expect(kaiMods.length).toBeGreaterThan(0)
    // The fixture model calls Kai's outcome-reducing change an "adaptation"; the guardrail relabels and blocks it.
    for (const m of kaiMods) expect(m.status).toBe('blocked')

    const sofiaMods = lens.results.find((r) => r.studentId === sofia)!.suggestions.filter((s) => s.label === 'modification')
    expect(sofiaMods.length).toBeGreaterThan(0)
    for (const m of sofiaMods) expect(m.status).toBe('draft')

    // Approving a blocked modification is refused and writes nothing.
    const blocked = await h.post(U.teacher, `/suggestions/${kaiMods[0].id}/approve?studentId=${kai}`, { expectedVersion: kaiMods[0].version })
    expect(blocked.status).toBeGreaterThanOrEqual(400)
    expect(h.studentSql(kai).get<{ n: number }>('SELECT COUNT(*) AS n FROM usage_events')?.n).toBe(0)

    // PRD 1A-7: approval writes the usage event in the same transaction.
    const approved = await h.post(U.teacher, `/suggestions/${sofiaMods[0].id}/approve?studentId=${sofia}`, { expectedVersion: sofiaMods[0].version })
    expect(approved.status).toBe(200)
    expect(approved.body.suggestion.status).toBe('approved')
    expect(approved.body.usageEventId).toEqual(expect.any(String))
    const usage = h.studentSql(sofia).all<{ id: string; suggestion_id: string }>('SELECT id, suggestion_id FROM usage_events')
    expect(usage).toEqual([expect.objectContaining({ id: approved.body.usageEventId, suggestion_id: sofiaMods[0].id })])

    // A stale version answers 409.
    const stale = await h.post(U.teacher, `/suggestions/${sofiaMods[0].id}/reject?studentId=${sofia}`, { expectedVersion: sofiaMods[0].version })
    expect(stale.status).toBe(409)
  })

  it('prints coded sheets with checks; codes and pages carry no names, answer key separate', async () => {
    const h = createHarness()
    const { lesson, sheets } = await approvedMathSheets(h, sofia)
    expect(sheets.pages.length).toBeGreaterThan(0)
    for (const page of sheets.pages) {
      expect(page.sheetCode).toMatch(/^AL-[A-Z0-9]+$/)
      expect(page.checkItems.length).toBeGreaterThan(0)
      expect(page).not.toHaveProperty('answerKey')
    }
    expect(sheets.answerKey.map((k) => k.sheetCode)).toEqual(sheets.pages.map((p) => p.sheetCode))
    const printed = JSON.stringify(sheets.pages)
    for (const name of FIXTURE_NAMES) expect(printed).not.toContain(name)
    // Codes are stable per student, lesson and check.
    const again = await h.get(U.teacher, `/lessons/${lesson.id}/sheets/${sofia}`)
    expect(again.body.pages.map((p: { sheetCode: string }) => p.sheetCode)).toEqual(sheets.pages.map((p) => p.sheetCode))
  })
})
