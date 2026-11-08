import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_NAMES } from '../fixtures'
import { getProvider } from '../ai/provider'
import { closeAll } from '../services/testing'
import { kai, U } from './flows'
import { createHarness } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  return closeAll()
})

const ticketBody = { target: 'accommodations', proposedChange: 'Extra time on written tasks.', reason: 'Fatigue in long writing blocks.' }

describe('T2: IEP change tickets', () => {
  it('decline keeps the IEP version; the case manager sees the outcome', async () => {
    const h = createHarness()
    const { ticket } = (await h.post(U.caseManager, `/students/${kai}/tickets`, ticketBody)).body
    const before = (await h.get(U.caseManager, `/students/${kai}`)).body.iepVersion
    const res = await h.post(U.schoolAdmin, `/tickets/${ticket.id}/decline`, { reason: 'Needs team review' })
    expect(res.status).toBe(200)
    expect(res.body.ticket.status).toBe('declined')
    expect((await h.get(U.caseManager, `/students/${kai}`)).body.iepVersion).toBe(before)
    const mine = (await h.get(U.caseManager, `/students/${kai}/tickets`)).body.tickets
    expect(mine[0]).toMatchObject({ status: 'declined', declineReason: 'Needs team review' })
  })

  it('apply bumps the version by 1, writes an audit entry, and the case manager sees it applied', async () => {
    const h = createHarness()
    const { ticket } = (await h.post(U.caseManager, `/students/${kai}/tickets`, ticketBody)).body
    const before = (await h.get(U.caseManager, `/students/${kai}`)).body.iepVersion
    const res = await h.post(U.schoolAdmin, `/tickets/${ticket.id}/apply`)
    expect(res.status).toBe(200)
    expect(res.body.iepVersion).toBe(before + 1)
    expect((await h.get(U.caseManager, `/students/${kai}`)).body.iepVersion).toBe(before + 1)
    expect(h.school.get("SELECT 1 AS x FROM audit_log WHERE action = 'iep_change_tickets.apply'")).toBeTruthy()
    expect(h.studentSql(kai).get("SELECT 1 AS x FROM audit_log WHERE action = 'iep_versions.ticket_apply'")).toBeTruthy()
    expect((await h.get(U.caseManager, `/students/${kai}/tickets`)).body.tickets[0].status).toBe('applied')
  })
})

describe('S3: read-aloud audio', () => {
  it('refuses a draft summary text and serves the approved one (204 = browser speech)', async () => {
    const h = createHarness()
    const gen = await h.post(U.ea, `/students/${kai}/summaries/generate`, { kind: 'monthly', period: '2026-10', language: 'es' })
    const { id, version, text } = gen.body.summary
    const tts = (text: string) => h.post(U.parentKai, '/tts', { text, language: 'es', studentId: kai })

    const draft = await tts(text)
    expect([403, 404]).toContain(draft.status)
    expect(draft.body).not.toBeInstanceOf(ArrayBuffer)
    // Arbitrary text is not playable either.
    expect((await tts('Anything else at all.')).status).toBe(403)

    expect((await h.post(U.ea, `/summaries/${id}/approve`, { studentId: kai, version })).status).toBe(200)
    expect([200, 204]).toContain((await tts(text)).status)
    // Another family's parent cannot play this child's text.
    expect((await h.post(U.parentSofia, '/tts', { text, language: 'es', studentId: kai })).status).toBe(403)
  })
})

describe('O3: AI provider choice and de-identification', () => {
  it('no key gives the fixture provider; a key gives Gemini', () => {
    expect(getProvider({}).name).toBe('fixture')
    expect(getProvider({ GEMINI_API_KEY: '  ' }).name).toBe('fixture')
    expect(getProvider({ GEMINI_API_KEY: 'fake-test-key' }).name).toBe('gemini')
  })

  it('outgoing Gemini request bodies contain no student real names', async () => {
    const bodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ''))
        return new Response('{"error":"fake"}', { status: 400 })
      }),
    )
    const gemini = getProvider({ GEMINI_API_KEY: 'fake-test-key' })
    const { name: _name, ...ai } = gemini
    const h = createHarness({ ai })
    const res = await h.post(U.teacher, `/students/${kai}/lesson-plans`, { title: 'Salmon', text: 'Read the short text about salmon. Retell the main idea.' })
    expect(res.status).toBe(201)
    expect(bodies.length).toBeGreaterThan(0)
    const all = bodies.join('\n')
    for (const n of FIXTURE_NAMES) expect(all, n).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, 'iu'))
  })
})
