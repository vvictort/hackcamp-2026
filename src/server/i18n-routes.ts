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
 * ponytail: whole-catalogue regeneration when en.ts changes; translate only
 * the changed keys if the catalogue grows large.
 */

import type { Hono } from 'hono'
import { apiWorkerFetch } from 'deepspace/worker'
import { en } from '../i18n/en.js'
import { findLanguage } from '../i18n/languages.js'
import type { AppContext, Env } from '../../worker.js'

const MODEL = 'claude-haiku-5-5'
const CHUNK = 40
const KEEP = 'Altamyra, MyEd, MyEducation BC, IEP, FESL, Pulse, Lesson Lens, Progress Drafts, Today View, Family Bridge, District Insights, QR'

type Catalogue = Record<string, string>

/** Version of the catalogue and the do-not-translate list; changing either invalidates cached translations. */
function catalogueVersion(): string {
  let h = 5381
  for (const ch of JSON.stringify([en, KEEP])) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}

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

async function readCache(env: Env, lang: string): Promise<{ recordId?: string; value?: { v: string; messages: Catalogue } }> {
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
      max_tokens: 4096,
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

const inFlight = new Map<string, Promise<Catalogue>>()

async function build(env: Env, lang: string, name: string): Promise<Catalogue> {
  const entries = Object.entries(en) as [string, string][]
  const out: Catalogue = {}
  for (let i = 0; i < entries.length; i += CHUNK) {
    Object.assign(out, await translateChunk(env, name, Object.fromEntries(entries.slice(i, i + CHUNK))))
  }
  const cached = await readCache(env, lang)
  const value = JSON.stringify({ v: catalogueVersion(), messages: out })
  if (cached.recordId) await room(env, 'records.update', { collection: 'settings', recordId: cached.recordId, data: { value } })
  else await room(env, 'records.create', { collection: 'settings', data: { key: `i18n:${lang}`, value } })
  return out
}

export function registerI18nRoutes(app: Hono<AppContext>): void {
  app.get('/api/i18n/:lang', async (c) => {
    const language = findLanguage(c.req.param('lang'))
    if (!language || language.code === 'en') return c.json({ error: 'Unsupported language' }, 404)
    const { code, name } = language
    try {
      const cached = await readCache(c.env, code)
      let messages = cached.value?.v === catalogueVersion() ? cached.value.messages : undefined
      if (!messages) {
        let job = inFlight.get(code)
        if (!job) {
          job = build(c.env, code, name).finally(() => inFlight.delete(code))
          inFlight.set(code, job)
        }
        messages = await job
      }
      c.header('Cache-Control', 'public, max-age=3600')
      return c.json({ lang: code, v: catalogueVersion(), messages })
    } catch (err) {
      console.error('[i18n]', code, err instanceof Error ? err.message : err)
      return c.json({ error: 'Translation unavailable' }, 503)
    }
  })
}
