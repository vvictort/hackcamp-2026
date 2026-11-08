/**
 * GET /api/i18n/:lang  (public)
 *
 * Returns the interface strings in one language. The first request for a
 * language machine-translates src/i18n/en.ts with Claude, stores the result in
 * the `settings` collection (key `i18n:<lang>`), and every later request is
 * served from that row.
 *
 * Privacy and cost: the route accepts NO text. It translates only the static
 * English catalogue, and only for language codes in src/i18n/languages.ts, so
 * no user or record data can reach the model and total spend is bounded by
 * (languages x catalogue size). The app owner pays for the calls.
 * Resilience: chunks run in parallel, a failed or truncated chunk is split and
 * retried, keys that still fail fall back to English, and a partial result is
 * saved and completed on the next request instead of being thrown away.
 * ponytail: a changed catalogue regenerates the whole language; translate only
 * the changed keys if the catalogue grows large.
 */

import type { Hono } from 'hono'
import { apiWorkerFetch } from 'deepspace/worker'
import { en } from '../i18n/en.js'
import { findLanguage } from '../i18n/languages.js'
import { KEEP, catalogueVersion, freshMessages, hashText, sourceHashes } from '../i18n/version.js'
import type { AppContext, Env } from '../../worker.js'

const MODEL = 'claude-haiku-5-5'
/** Small chunks keep each reply well inside the output limit, even for scripts that tokenise heavily (Tamil, Thai, Amharic). */
const CHUNK = 20
const CONCURRENCY = 6
const MAX_TOKENS = 8192

type Catalogue = Record<string, string>

async function room(env: Env, tool: string, params: Record<string, unknown>) {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  const res = await stub.fetch(
    new Request('https://internal/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': env.OWNER_USER_ID, 'X-App-Action': 'true' },
      body: JSON.stringify({ tool, params }),
    }),
  )
  return (await res.json()) as { success: boolean; data?: { records?: { recordId: string; data: { value?: string } }[] } }
}

type Stored = { v: string; keep?: string; src?: Record<string, string>; messages: Catalogue }

async function readCache(env: Env, lang: string): Promise<{ recordId?: string; value?: Stored }> {
  const r = await room(env, 'records.query', { collection: 'settings', where: { key: `i18n:${lang}` }, limit: 1 })
  const rec = r.data?.records?.[0]
  if (!rec?.data.value) return { recordId: rec?.recordId }
  try {
    return { recordId: rec.recordId, value: JSON.parse(rec.data.value) }
  } catch {
    return { recordId: rec.recordId }
  }
}

/** Pull the text out of an Anthropic Messages response, whatever the envelope nests it under. */
function textOf(data: unknown): string {
  const d = data as { content?: { text?: string }[]; text?: string } | undefined
  return d?.content?.map((c) => c.text ?? '').join('') ?? d?.text ?? ''
}

async function translateChunk(env: Env, language: string, chunk: Catalogue): Promise<Catalogue> {
  const res = await apiWorkerFetch(env, '/api/integrations/anthropic/chat-completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APP_OWNER_JWT}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system:
        `You translate user-interface text for a school app used by teachers and families. Translate the JSON values from English into ${language}. ` +
        `Keep the keys exactly. Keep {placeholders} and inline tags such as <hl>, <muted>, <b> exactly as written (translate the text between them), and keep these names unchanged: ${KEEP}. Use a clear, friendly, plain tone. Reply with the JSON object only.`,
      messages: [{ role: 'user', content: JSON.stringify(chunk) }],
    }),
  })
  const payload = (await res.json()) as { success?: boolean; data?: unknown }
  if (!res.ok || payload.success === false) throw new Error(`translation failed (${res.status})`)
  const text = textOf(payload.data)
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Catalogue
  // Only accept the keys we asked for, as strings that keep their placeholders.
  const out: Catalogue = {}
  for (const [k, src] of Object.entries(chunk)) {
    const v = json[k]
    const keeps = (src.match(/\{\w+\}|<\/?\w+>/g) ?? []).every((p) => typeof v === 'string' && v.includes(p))
    if (typeof v === 'string' && v.trim() && keeps) out[k] = v
  }
  return out
}

const pick = (from: Catalogue, keys: string[]): Catalogue => Object.fromEntries(keys.map((k) => [k, from[k]]))

/** Translate a chunk; on a bad reply, retry what is missing, or split the chunk and retry the halves. */
async function translateSafe(env: Env, language: string, chunk: Catalogue, depth = 0): Promise<Catalogue> {
  const keys = Object.keys(chunk)
  let out: Catalogue = {}
  try {
    out = await translateChunk(env, language, chunk)
  } catch (err) {
    console.error('[i18n] chunk failed', keys.length, err instanceof Error ? err.message : err)
  }
  const missing = keys.filter((k) => !(k in out))
  if (!missing.length || depth >= 3) return out
  if (missing.length > 1 && Object.keys(out).length === 0) {
    const mid = missing.length >> 1
    const [a, b] = await Promise.all([
      translateSafe(env, language, pick(chunk, missing.slice(0, mid)), depth + 1),
      translateSafe(env, language, pick(chunk, missing.slice(mid)), depth + 1),
    ])
    return { ...out, ...a, ...b }
  }
  return { ...out, ...(await translateSafe(env, language, pick(chunk, missing), depth + 1)) }
}

const inFlight = new Map<string, Promise<Catalogue>>()

/** Translate the keys in `existing`'s blind spot, save, and return everything translated so far. */
async function build(env: Env, lang: string, name: string, existing: Catalogue, recordId?: string): Promise<Catalogue> {
  const todo = (Object.entries(en) as [string, string][]).filter(([k]) => !existing[k])
  const chunks: Catalogue[] = []
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(Object.fromEntries(todo.slice(i, i + CHUNK)))
  const out: Catalogue = { ...existing }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length) Object.assign(out, await translateSafe(env, name, chunks[next++]))
    }),
  )
  if (Object.keys(out).length > Object.keys(existing).length) {
    const now = sourceHashes()
    const live = Object.fromEntries(Object.entries(out).filter(([k]) => k in now)) // drop strings that left the catalogue
    const src = Object.fromEntries(Object.keys(live).map((k) => [k, now[k]]))
    const value = JSON.stringify({ v: catalogueVersion(), keep: hashText(KEEP), src, messages: live })
    if (recordId) await room(env, 'records.update', { collection: 'settings', recordId, data: { value } })
    else await room(env, 'records.create', { collection: 'settings', data: { key: `i18n:${lang}`, value } })
  }
  return out
}

const total = Object.keys(en).length

export function registerI18nRoutes(app: Hono<AppContext>): void {
  app.get('/api/i18n/:lang', async (c) => {
    const language = findLanguage(c.req.param('lang'))
    if (!language || language.code === 'en') return c.json({ error: 'Unsupported language' }, 404)
    const { code, name } = language
    try {
      const cached = await readCache(c.env, code)
      // Reuse every stored translation whose English did not change; only the rest is translated.
      // ?rebuild=1 (local dev only) ignores the stored copy and translates everything again.
      const local = ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname)
      const current = cached.value && !(local && c.req.query('rebuild') === '1') ? freshMessages(cached.value) : {}
      const have = (m: Catalogue) => Object.keys(en).filter((k) => m[k]).length
      let messages = current
      if (have(current) < total) {
        let job = inFlight.get(code)
        if (!job) {
          job = build(c.env, code, name, current, cached.recordId).finally(() => inFlight.delete(code))
          inFlight.set(code, job)
        }
        messages = await job
      }
      const done = have(messages)
      if (done === 0) throw new Error('nothing translated')
      // A partial result is served (English fills the gaps) but not cached by browsers, so the next request completes it.
      c.header('Cache-Control', done === total ? 'public, max-age=3600' : 'no-store')
      const now = sourceHashes()
      const live = Object.fromEntries(Object.entries(messages).filter(([k]) => k in now))
      const src = Object.fromEntries(Object.keys(live).map((k) => [k, now[k]]))
      return c.json({ lang: code, v: catalogueVersion(), keep: hashText(KEEP), src, complete: done === total, messages: live })
    } catch (err) {
      console.error('[i18n]', code, err instanceof Error ? err.message : err)
      return c.json({ error: 'Translation unavailable' }, 503)
    }
  })
}
