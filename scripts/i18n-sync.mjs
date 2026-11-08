#!/usr/bin/env node
/**
 * Writes src/i18n/locales/<lang>.json for every language by asking the app's
 * own /api/i18n/:lang route (which translates the English catalogue with
 * Claude and caches it). Commit the files: the app then loads each language
 * instantly with no AI call.
 *
 *   npm run dev            (in another terminal; you must be signed in to DeepSpace)
 *   node scripts/i18n-sync.mjs [--base http://localhost:5173] [--all | --stale] [es fr pa ...]
 *
 * Default is --stale: only languages whose file is missing or behind the
 * English text. Re-run it after changing src/i18n/en/*.ts, then commit.
 * Costs one round of AI calls per language that needs updating.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:5173'
const named = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--base')

const langsSrc = await readFile(join(root, 'src/i18n/languages.ts'), 'utf8')
const all = [...langsSrc.matchAll(/code: '([\w-]+)'/g)].map((m) => m[1]).filter((c) => c !== 'en')
const wanted = named.length ? named : all

const health = await fetch(`${base}/api/i18n/${wanted[0]}`, { method: 'HEAD' }).catch(() => null)
if (!health) {
  console.error(`Cannot reach ${base}. Start the app (npm run dev) first.`)
  process.exit(1)
}

// The version the app expects, read from the same route (it reports it with every reply).
const dir = join(root, 'src/i18n/locales')
await mkdir(dir, { recursive: true })

async function current(code) {
  try {
    return JSON.parse(await readFile(join(dir, `${code}.json`), 'utf8'))
  } catch {
    return null
  }
}

let expected = null
async function sync(code) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${base}/api/i18n/${code}`, { signal: AbortSignal.timeout(280_000) }).catch(() => null)
    if (res?.ok) {
      const body = await res.json()
      expected = body.v
      if (!body.complete) {
        console.warn(`${code}: partial (${Object.keys(body.messages).length} keys), retrying`)
        continue
      }
      await writeFile(join(dir, `${code}.json`), JSON.stringify({ v: body.v, messages: body.messages }, null, 1) + '\n')
      return `${code}: ${Object.keys(body.messages).length} keys`
    }
    console.warn(`${code}: attempt ${attempt} failed (${res?.status ?? 'no answer'})`)
  }
  return `${code}: FAILED`
}

const queue = [...wanted]
const results = []
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const code = queue.shift()
      const have = await current(code)
      if (!flag('--all') && have && expected && have.v === expected) {
        results.push(`${code}: up to date`)
        continue
      }
      results.push(await sync(code))
      console.log(results.at(-1))
    }
  }),
)
const failed = results.filter((r) => r.endsWith('FAILED'))
console.log(`\nDone: ${results.length - failed.length}/${results.length} languages.${failed.length ? ' Failed: ' + failed.join(', ') : ''}`)
process.exit(failed.length ? 1 : 0)
