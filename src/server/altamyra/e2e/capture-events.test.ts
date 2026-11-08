import { afterEach, describe, expect, it } from 'vitest'
import { closeAll } from './testing'
import { kai, TODAY, U } from './flows'
import { createHarness } from './harness'

afterEach(closeAll)

type Goal = { objectiveId: string; metricType: string }
const goalsOf = async (h: ReturnType<typeof createHarness>) =>
  (await h.get(U.ea, `/students/${kai}/capture-objectives`)).body.objectives as Goal[]
const byMetric = (goals: Goal[], metric: string) => goals.find((g) => g.metricType === metric)!.objectiveId

describe('event logging for the EA (C4)', () => {
  it('logs prompt level, counter and timer events on matching objectives and shows them in today', async () => {
    const h = createHarness()
    const goals = await goalsOf(h)
    const prompt = byMetric(goals, 'prompt_level')
    const counter = byMetric(goals, 'frequency')
    const timer = byMetric(goals, 'duration')
    const a = await h.post(U.ea, `/students/${kai}/events`, { kind: 'prompt_level', objectiveId: prompt, promptLevel: 'verbal' })
    const b = await h.post(U.ea, `/students/${kai}/events`, { kind: 'counter', objectiveId: counter, count: 3 })
    const c = await h.post(U.ea, `/students/${kai}/events`, { kind: 'timer', objectiveId: timer, durationSeconds: 300 })
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201])
    const day = await h.get(U.ea, `/students/${kai}/days/${TODAY}`)
    const ids = JSON.stringify(day.body)
    for (const r of [a, b, c]) expect(ids).toContain(r.body.dataPoint.id)
  })

  it('refuses an event whose kind does not fit the objective metric', async () => {
    const h = createHarness()
    const goals = await goalsOf(h)
    const wrong = [
      { kind: 'counter', objectiveId: byMetric(goals, 'prompt_level'), count: 1 },
      { kind: 'timer', objectiveId: byMetric(goals, 'frequency'), durationSeconds: 60 },
      { kind: 'prompt_level', objectiveId: byMetric(goals, 'duration'), promptLevel: 'verbal' },
    ]
    for (const body of wrong) expect((await h.post(U.ea, `/students/${kai}/events`, body)).status).toBe(400)
  })
})

describe('voice notes and videos: consent and upload keys', () => {
  const audio = (fileKey: string) => ({ audio: { fileKey, contentType: 'audio/webm' } })
  const video = (fileKey: string) => ({ fileKey, contentType: 'video/mp4', sizeBytes: 10 })
  const consentOff = async (h: ReturnType<typeof createHarness>, kind: string) =>
    expect((await h.call(U.parentKai, 'PUT', `/family/${kai}/consents`, { kind, granted: false })).status).toBe(200)
  const throwOnDelete = (h: ReturnType<typeof createHarness>) => {
    h.deletedFiles.push = () => {
      throw new Error('Access denied: key outside scope')
    }
  }

  it('voice note without consent is 403 consent_required and the recording is deleted', async () => {
    const h = createHarness()
    await consentOff(h, 'voice_note')
    const res = await h.post(U.ea, `/students/${kai}/voice-notes`, audio('voice/1.webm'))
    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain('consent_required')
    expect(h.deletedFiles).toEqual(['voice/1.webm'])
  })

  it('voice note without consent stays 403 when the cleanup delete throws', async () => {
    const h = createHarness()
    await consentOff(h, 'voice_note')
    throwOnDelete(h)
    const res = await h.post(U.ea, `/students/${kai}/voice-notes`, audio('voice/2.webm'))
    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain('consent_required')
  })

  it('a key outside the upload scope is 400, with or without consent', async () => {
    const h = createHarness()
    expect((await h.post(U.ea, `/students/${kai}/voice-notes`, audio('../other/a.webm'))).status).toBe(400)
    expect((await h.post(U.ea, `/students/${kai}/videos`, video('/etc/v.mp4'))).status).toBe(400)
    await consentOff(h, 'voice_note')
    await consentOff(h, 'video')
    throwOnDelete(h)
    const a = await h.post(U.ea, `/students/${kai}/voice-notes`, audio('../other/a.webm'))
    const v = await h.post(U.ea, `/students/${kai}/videos`, video('a/../../v.mp4'))
    expect([a.status, v.status]).toEqual([400, 400])
    expect(h.errors).toEqual([])
  })

  it('video without consent is 403 and deletion is attempted, even when it throws', async () => {
    const h = createHarness()
    await consentOff(h, 'video')
    const res = await h.post(U.ea, `/students/${kai}/videos`, video('videos/1.mp4'))
    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain('consent_required')
    expect(h.deletedFiles).toEqual(['videos/1.mp4'])
    throwOnDelete(h)
    expect((await h.post(U.ea, `/students/${kai}/videos`, video('videos/2.mp4'))).status).toBe(403)
  })
})
