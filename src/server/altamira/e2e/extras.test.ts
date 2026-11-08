import { afterEach, describe, expect, it } from 'vitest'
import { DISTRICT } from '../fixtures'
import { closeAll } from '../services/testing'
import { amara, createLesson, kai, runLens, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

describe('remaining /api/v1 flows', () => {
  it('voice notes need audio consent; the recording is deleted either way', async () => {
    const h = createHarness()
    const audio = (key: string) => ({ audio: { fileKey: key, contentType: 'audio/webm' } })
    const refused = await h.post(U.teacher, `/students/${amara}/voice-notes`, audio('ea/note-1.webm'))
    expect(refused.status).toBe(403)
    expect(h.deletedFiles).toContain('ea/note-1.webm')
    expect(h.aiCalls.parseVoiceNote).toBe(0)

    // Only confirmed objectives are offered to the parser; confirm Sofía's counter objective first.
    const objectives = (await h.get(U.caseManager, `/students/${sofia}/objectives`)).body.objectives
    const counter = objectives.find((o: { metricType: string }) => o.metricType === 'frequency')
    expect((await h.post(U.caseManager, `/objectives/${counter.id}/confirm?studentId=${sofia}`, { expectedVersion: counter.version })).status).toBe(200)

    const ok = await h.post(U.ea,`/students/${sofia}/voice-notes`, audio('ea/note-2.webm'))
    expect(ok.status, String(h.errors[0])).toBe(201)
    expect(ok.body.audioDeleted).toBe(true)
    expect(ok.body.dataPoints.length).toBeGreaterThan(0)
    expect(h.deletedFiles).toContain('ea/note-2.webm')
  })

  it('regenerate swaps in a new adaptation labelled by the guardrail', async () => {
    const h = createHarness()
    const lesson = await createLesson(h, 'literacy')
    const lens = await runLens(h, lesson.id)
    const target = lens.results.find((r) => r.studentId === kai)!.suggestions.find((s) => s.kind === 'adaptation')
    const res = await h.post(U.teacher, `/suggestions/${target.id}/regenerate?studentId=${kai}`, { expectedVersion: target.version })
    expect(res.status).toBe(200)
    expect(res.body.suggestion.id).not.toBe(target.id)
    expect(['adaptation', 'modification']).toContain(res.body.suggestion.label)
    expect(h.aiCalls.analyseLesson).toBe(1)
  })

  it('family summary is drafted from a Progress Draft and approved by the case manager', async () => {
    const h = createHarness()
    const goal = h.studentSql(kai).get<{ goal_id: string }>(
      "SELECT o.goal_id FROM data_points d JOIN objectives o ON o.id = d.objective_id WHERE d.status IN ('confirmed','auto_confirmed') LIMIT 1",
    )!
    const draft = await h.post(U.caseManager, `/students/${kai}/drafts`, { goalId: goal.goal_id, period: 'Term 1' })
    expect(draft.status).toBe(201)
    const summary = await h.post(U.caseManager, `/drafts/${draft.body.draft.id}/family-summary?studentId=${kai}`, { language: 'fr' })
    expect(summary.status).toBe(201)
    expect(summary.body.summary.language).toBe('fr')
    const approved = await h.post(U.caseManager, `/family-summaries/${summary.body.summary.id}/approve?studentId=${kai}`, {
      expectedVersion: summary.body.summary.version,
    })
    expect(approved.status).toBe(200)
    const family = await h.get(U.parentKai, `/family/${kai}/progress`)
    expect(family.body.summaries.map((s: { id: string }) => s.id)).toContain(summary.body.summary.id)
  })

  it('district insights: district lead only, small groups suppressed', async () => {
    const h = createHarness()
    const res = await h.get(U.districtLead, `/districts/${DISTRICT.id}/insights?groupBy=goalArea`)
    expect(res.status).toBe(200)
    for (const g of res.body.groups) if (g.suppressed) expect(g.students).toBeNull()
    expect((await h.get(U.caseManager, `/districts/${DISTRICT.id}/insights`)).status).toBe(403)
  })
})
