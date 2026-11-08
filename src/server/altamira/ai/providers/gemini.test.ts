import { describe, expect, it, vi } from 'vitest'
import { fixtureRoster } from '../fixture-data'
import { FIXTURE_NAMES } from '../../fixtures'
import { createAi } from '../functions'
import { AiOutputError } from '../errors'
import { getProvider } from '../provider'
import { createFixtureProvider } from './fixture'
import { createGeminiProvider, DEFAULT_GEMINI_MODELS } from './gemini'

const OBJECTIVE = {
  measurable: true,
  goalId: 'g1',
  metricType: 'accuracy',
  unit: '% correct',
  baselineMethod: 'Median of 3 checks',
  target: 80,
  masteryRule: '80% on 3 checks',
  captureMethod: 'photo',
}
const ok = (payload: unknown = OBJECTIVE) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 })
const INPUT = { studentToken: 'S-X', goalId: 'g1', area: 'Reading', goalText: 'Retell a story' }
const modelOf = (url: unknown) => String(url).match(/models\/([^:]+):/)?.[1]

describe('gemini provider', () => {
  it('calls the first model with the key header and validates JSON output', async () => {
    const f = vi.fn(async () => ok())
    const p = createGeminiProvider({ apiKey: 'secret-key', fetch: f as unknown as typeof fetch })
    expect(await p.proposeObjectives(INPUT)).toMatchObject({ measurable: true, target: 80 })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    expect(JSON.parse(init.body as string).generationConfig.responseMimeType).toBe('application/json')
  })

  it('falls over to the next model on 429, 503 and 404', async () => {
    const statuses = [429, 503, 404]
    const f = vi.fn(async () => (statuses.length ? new Response('x', { status: statuses.shift() }) : ok()))
    const p = createGeminiProvider({ apiKey: 'k', fetch: f as unknown as typeof fetch })
    await p.proposeObjectives(INPUT)
    expect(f.mock.calls.map((c) => modelOf((c as unknown[])[0]))).toEqual(DEFAULT_GEMINI_MODELS.split(',').slice(0, 4))
  })

  it('moves on after a timeout', async () => {
    let n = 0
    const f = vi.fn((_u: unknown, init: RequestInit) =>
      ++n === 1
        ? new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
        : Promise.resolve(ok()),
    )
    const p = createGeminiProvider({ apiKey: 'k', timeoutMs: 20, models: 'm1,m2', fetch: f as unknown as typeof fetch })
    await p.proposeObjectives(INPUT)
    expect(f.mock.calls.map((c) => modelOf(c[0]))).toEqual(['m1', 'm2'])
  })

  it('throws when every model fails and no fallback is set', async () => {
    const f = vi.fn(async () => new Response('x', { status: 429 }))
    const p = createGeminiProvider({ apiKey: 'k', models: 'a,b', fetch: f as unknown as typeof fetch })
    await expect(p.proposeObjectives(INPUT)).rejects.toThrow(/All Gemini models failed/)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('on 400/401/403 uses the fixture without trying more models', async () => {
    for (const status of [400, 401, 403]) {
      const f = vi.fn(async () => new Response('x', { status }))
      const p = createGeminiProvider({ apiKey: 'k', fetch: f as unknown as typeof fetch, fallback: createFixtureProvider() })
      expect(await p.proposeObjectives(INPUT)).toMatchObject({ goalId: 'g1' })
      expect(f).toHaveBeenCalledTimes(1)
      expect((p as unknown as { lastSource: string }).lastSource).toBe('fixture')
    }
  })

  it('without a fallback a fatal status throws, and off-schema output on every model throws AiOutputError', async () => {
    const f400 = vi.fn(async () => new Response('x', { status: 400 }))
    await expect(createGeminiProvider({ apiKey: 'k', fetch: f400 as unknown as typeof fetch }).proposeObjectives(INPUT)).rejects.toThrow(/HTTP 400/)
    const bad = createGeminiProvider({ apiKey: 'k', models: 'a,b', fetch: (async () => ok({ nope: 1 })) as unknown as typeof fetch })
    await expect(bad.proposeObjectives(INPUT)).rejects.toBeInstanceOf(AiOutputError)
  })

  it('falls back to the fixture when all models fail, and marks the source', async () => {
    const f = vi.fn(async () => new Response('x', { status: 404 }))
    const p = createGeminiProvider({ apiKey: 'k', models: 'a,b', fetch: f as unknown as typeof fetch, fallback: createFixtureProvider() })
    expect(await p.proposeObjectives(INPUT)).toMatchObject({ goalId: 'g1' })
    expect(f).toHaveBeenCalledTimes(2)
    expect((p as unknown as { lastSource: string }).lastSource).toBe('fixture')
  })

  it('tries the next model when output is fenced garbage, accepts fenced JSON', async () => {
    const fenced = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(OBJECTIVE) + '\n```' }] } }] }), { status: 200 })
    const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] }), { status: 200 })).mockResolvedValueOnce(fenced)
    const p = createGeminiProvider({ apiKey: 'k', models: 'a,b', fetch: f as unknown as typeof fetch })
    expect(await p.proposeObjectives(INPUT)).toMatchObject({ target: 80 })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('caps total wall time across the chain', async () => {
    const f = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))))
    const p = createGeminiProvider({ apiKey: 'k', models: 'a,b,c,d', timeoutMs: 30, totalTimeoutMs: 50, fetch: f as unknown as typeof fetch, fallback: createFixtureProvider() })
    const t0 = Date.now()
    await p.proposeObjectives(INPUT)
    expect(Date.now() - t0).toBeLessThan(500)
    expect(f.mock.calls.length).toBeLessThan(4)
  })

  it('no key: getProvider returns the fixture', () => {
    expect(getProvider({}).name).toBe('fixture')
    expect(() => createGeminiProvider({ apiKey: '' })).toThrow()
  })

  it('sends no student, staff or school name through createAi', async () => {
    const f = vi.fn(async () => ok({ language: 'en', text: 'Kai-free summary' }))
    const provider = createGeminiProvider({ apiKey: 'k', fetch: f as unknown as typeof fetch })
    const roster = fixtureRoster()
    const student = roster.students[0]
    const ai = createAi({ provider, roster })
    await ai.summariseForFamily({
      studentToken: student.token,
      language: 'en',
      draft: { sentences: [{ text: `${student.firstName} ${student.lastName} read well. Call ${roster.people[0]?.displayName ?? ''}.` }] },
    })
    const body = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    expect(body).not.toContain(student.firstName)
    expect(body).not.toContain(student.lastName)
    for (const n of FIXTURE_NAMES.slice(0, 3)) expect(body).not.toMatch(new RegExp(`\\b${n}\\b`))
    expect(body).toContain(student.token)
  })
})
