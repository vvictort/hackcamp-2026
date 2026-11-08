import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_HEADER } from '../middleware/auth'
import { closeAll } from '../services/testing'
import { amara, approvedMathSheets, kai, sofia, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

const goalTexts = (h: ReturnType<typeof createHarness>, studentId: string) =>
  h.studentSql(studentId).all<{ text: string }>('SELECT text FROM goals').map((g) => g.text)

describe('M3 student mode, decision rules and drafts through /api/v1', () => {
  it('student mode needs parental consent (Amara has none)', async () => {
    const h = createHarness()
    const refused = await h.post(U.teacher, `/students/${amara}/sessions`)
    expect(refused.status).toBe(403)
    expect(h.school.get<{ n: number }>("SELECT COUNT(*) AS n FROM share_tokens WHERE kind = 'student_session'")?.n).toBe(0)
    // Parents cannot start student mode.
    expect((await h.post(U.parentSofia, `/students/${sofia}/sessions`)).status).toBe(403)
  })

  it('a session delivers check items without IEP text and scores answers against the key in code', async () => {
    const h = createHarness({ devSeed: true })
    const { sheets } = await approvedMathSheets(h, sofia)
    const keyByPrompt = new Map<string, string>()
    sheets.pages.forEach((page, i) => {
      for (const item of page.checkItems) {
        const entry = sheets.answerKey[i].entries.find((e) => e.itemId === item.id)
        if (entry) keyByPrompt.set(item.prompt, entry.accepted[0])
      }
    })
    expect(keyByPrompt.size).toBeGreaterThan(0)

    const started = await h.post(U.teacher, `/students/${sofia}/sessions`)
    expect(started.status).toBe(201)
    const { sessionId, token } = started.body
    const auth = { [SESSION_HEADER]: token }

    // No session token, or another session's id: refused.
    expect((await h.get(null, `/sessions/${sessionId}/next`)).status).toBe(401)
    expect((await h.get(null, `/sessions/not-this-one/next`, auth)).status).toBe(403)

    const results: boolean[] = []
    for (let i = 0; i < 10; i++) {
      const next = await h.get(null, `/sessions/${sessionId}/next`, auth)
      expect(next.status).toBe(200)
      const text = JSON.stringify(next.body)
      for (const goal of goalTexts(h, sofia)) expect(text).not.toContain(goal)
      if (!next.body.item) break
      const item = next.body.item
      const key = keyByPrompt.get(item.prompt)
      if (key === undefined) continue
      // First item right, the rest wrong: scoring must follow the key exactly.
      const response = results.length === 0 ? key : `${key} not`
      const res = await h.post(null, `/sessions/${sessionId}/responses`, { itemId: item.itemId, response }, auth)
      expect(res.status).toBe(201)
      results.push(res.body.correct)
    }
    expect(results[0]).toBe(true)
    expect(results.slice(1).every((r) => r === false)).toBe(true)

    const progress = await h.get(null, `/sessions/${sessionId}/progress`, auth)
    expect(progress.status).toBe(200)
    for (const goal of goalTexts(h, sofia)) expect(JSON.stringify(progress.body)).not.toContain(goal)

    // Sessions time out (410 after expiry).
    h.clock.now += 31 * 60 * 1000
    expect((await h.get(null, `/sessions/${sessionId}/next`, auth)).status).toBe(410)
  })

  it('decision rules stay silent below 6 points even across 3 weeks', async () => {
    const h = createHarness()
    const objectives = await h.get(U.caseManager, `/students/${amara}/objectives`)
    const proposed = objectives.body.objectives.find((o: { metricType: string }) => o.metricType === 'prompt_level')
    const objective = (await h.post(U.caseManager, `/objectives/${proposed.id}/confirm?studentId=${amara}`, { expectedVersion: proposed.version })).body.objective
    const days = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-06']
    for (const day of days) {
      const res = await h.post(U.caseManager, `/students/${amara}/events`, {
        kind: 'prompt_level',
        objectiveId: objective.id,
        promptLevel: 'full_physical',
        recordedAt: `${day}T18:00:00.000Z`,
      })
      expect(res.status).toBe(201)
    }
    const digest = await h.get(U.caseManager, '/me/digest')
    expect(digest.status).toBe(200)
    expect(digest.body.items.filter((i: { decision: { objectiveId: string } }) => i.decision.objectiveId === objective.id)).toEqual([])
    const status = await h.get(U.caseManager, `/students/${amara}/goals/${objective.goalId}/status`)
    expect(status.body.latestDecision).toBeNull()
  })

  it('a draft citing another student’s data point is rejected; a valid draft is stored with checked citations', async () => {
    let foreignId = ''
    const h = createHarness({
      ai: { draftProgress: async () => ({ sentences: [{ text: 'Progress on the goal this term.', citations: [foreignId] }] }) },
    })
    const kaiTimeline = await h.get(U.caseManager, `/students/${kai}/timeline`)
    foreignId = kaiTimeline.body.dataPoints.find((d: { status: string }) => d.status === 'confirmed').id
    const goal = h.studentSql(sofia).get<{ id: string }>("SELECT id FROM goals WHERE status = 'active'")!
    const rejected = await h.post(U.caseManager, `/students/${sofia}/drafts`, { goalId: goal.id, period: 'Term 1' })
    expect(rejected.status).toBe(400)
    expect(rejected.body.error.code).toBe('bad_request')
    expect(h.studentSql(sofia).get<{ n: number }>('SELECT COUNT(*) AS n FROM progress_drafts')?.n).toBe(0)

    // The default fixture model cites the student's own confirmed points.
    const ok = createHarness()
    const kaiGoal = ok.studentSql(kai).get<{ goal_id: string }>(
      "SELECT o.goal_id FROM data_points d JOIN objectives o ON o.id = d.objective_id WHERE d.status IN ('confirmed','auto_confirmed') LIMIT 1",
    )!
    const draft = await ok.post(U.caseManager, `/students/${kai}/drafts`, { goalId: kaiGoal.goal_id, period: 'Term 1' })
    expect(draft.status).toBe(201)
    const cited = draft.body.draft.sentences.flatMap((s: { citations: string[] }) => s.citations)
    expect(cited.length).toBeGreaterThan(0)
    // BC reporting: a scale indicator is stated in relation to IEP goals.
    expect(JSON.stringify(draft.body.draft.sentences)).toMatch(/in relation to[^.]*IEP goal/i)
  })
})

describe('demo student self start (ALTAMIRA_DEV_SEED)', () => {
  const DEMO = 'demo-user-1'

  it('the student role starts a session for its own linked student only', async () => {
    const h = createHarness({ seed: false, devSeed: true })
    await h.post(DEMO, '/dev/seed')
    await h.post(DEMO, '/dev/role', { role: 'student' })
    const me = await h.get(DEMO, '/me')
    const own = kai
    expect(Object.keys(me.body.studentRoles ?? {}).concat(me.body.memberships.map((m: { studentId: string }) => m.studentId))).toContain(own)
    const ok = await h.post(DEMO, `/students/${own}/student-mode/start`)
    expect(ok.body).toMatchObject({ token: expect.any(String) })
    expect(ok.status).toBe(201)
    const other = await h.post(DEMO, `/students/${amara}/student-mode/start`)
    expect(other.status).toBe(403)
    expect(other.body.error?.message ?? other.body.message ?? JSON.stringify(other.body)).toMatch(/teacher or EA/)
  })

  it('a linked student account (parent link) may self start in dev seed only', async () => {
    const h = createHarness({ devSeed: true })
    const res = await h.post(U.parentKai, `/students/${kai}/student-mode/start`)
    expect(res.status).toBe(201)
    expect((await h.post(U.parentSofia, `/students/${kai}/student-mode/start`)).status).toBe(403)
  })

  it('without the dev flag a parent link cannot self start', async () => {
    const h = createHarness({ devSeed: false })
    const res = await h.post(U.parentKai, `/students/${kai}/student-mode/start`)
    expect(res.status).toBe(403)
  })
})
