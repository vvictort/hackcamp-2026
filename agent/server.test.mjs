// Run with: node --test agent/
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SERVER = new URL('./server.mjs', import.meta.url).pathname
const TOKEN = 'test-token'
const NAME = 'Zephyrine Okonkwo-Larsen' // fictional marker; must never reach the logs
const TEACHER = 'a1b2c3d4e5'

// Start server.mjs on a random port; resolve once it prints its port.
async function start(env) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lesson-lens-'))
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, PORT: '0', DATA_DIR: dataDir, AGENT_TOKEN: TOKEN, ...env },
  })
  let logs = ''
  child.stdout.on('data', (d) => { logs += d })
  child.stderr.on('data', (d) => { logs += d })
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', () => { const m = /listening on (\d+)/.exec(logs); if (m) resolve(Number(m[1])) })
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${logs}`)))
  })
  return {
    dataDir,
    logs: () => logs,
    base: `http://127.0.0.1:${port}`,
    async stop() { child.kill(); await rm(dataDir, { recursive: true, force: true }) },
  }
}

const chat = (srv, message, token = TOKEN) => fetch(`${srv.base}/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ message: JSON.stringify(message) }),
})

const LESSON = {
  task: 'lesson-lens',
  teacher: TEACHER,
  subject: 'Numeracy',
  lesson: 'Multiplication with arrays',
  details: `Students build arrays with tiles. Note for ${NAME}.`,
  students: [
    { key: 'Student A', goals: [{ id: 'g-math', area: 'Math (modified)', text: `Count and add groups to 20 with cubes. ${'Long goal text. '.repeat(40)}`, level: 'Developing' }] },
    { key: 'Student B', goals: [
      { id: 'g-reg1', area: 'Self-regulation', text: 'Starts tasks within two minutes with a visual schedule.', level: 'Emerging' },
      { id: 'g-reg2', area: 'Attention', text: 'Stays with a task for ten minutes.', level: 'Developing' },
      { id: 'g-reg3', area: 'Social', text: `Takes turns in a group of three. ${NAME}`, level: 'Developing' },
    ] },
    { key: 'Student C', goals: [{ id: 'g-read', area: 'Reading', text: 'Decodes CVC words.', level: 'Developing' }] },
    { key: 'Student D', goals: [{ id: 'g-para', area: 'Paragraph writing', text: 'Writes a five-sentence paragraph on an individual topic.', level: 'Developing' }] },
  ],
}

function assertShape(body, known) {
  assert.ok(['gemini', 'rules'].includes(body.source))
  assert.ok(Array.isArray(body.suggestions))
  const perStudent = {}
  for (const s of body.suggestions) {
    assert.deepEqual(Object.keys(s).sort(), ['goalId', 'kind', 'studentKey', 'text', 'why'])
    assert.ok(known[s.studentKey]?.includes(s.goalId), `unknown pair ${s.studentKey}/${s.goalId}`)
    assert.ok(['adaptation', 'modification'].includes(s.kind))
    assert.ok(s.text.length > 0 && s.text.length <= 300, `text length ${s.text.length}`)
    assert.ok(s.why.length > 0 && s.why.length <= 300, `why length ${s.why.length}`)
    assert.ok(!s.text.includes('—') && !s.why.includes('—'), 'no em dashes')
    perStudent[s.studentKey] = (perStudent[s.studentKey] ?? 0) + 1
  }
  for (const n of Object.values(perStudent)) assert.ok(n <= 2)
}
const KNOWN = Object.fromEntries(LESSON.students.map((s) => [s.key, s.goals.map((g) => g.id)]))

let srv
before(async () => { srv = await start({}) })
after(async () => {
  assert.ok(!srv.logs().includes(NAME), 'names never appear in logs')
  assert.ok(!srv.logs().includes(TOKEN), 'token never appears in logs')
  await srv.stop()
})

test('GET /health is open', async () => {
  const res = await fetch(`${srv.base}/health`)
  assert.equal(res.status, 200)
})

test('POST /chat needs the bearer token', async () => {
  assert.equal((await chat(srv, LESSON, null)).status, 401)
  assert.equal((await chat(srv, LESSON, 'wrong')).status, 401)
})

test('lesson-lens without a key is served by the rules fallback', async () => {
  const res = await chat(srv, LESSON)
  assert.equal(res.status, 200)
  const body = JSON.parse((await res.json()).response)
  assert.equal(body.source, 'rules')
  assertShape(body, KNOWN)
  const a = body.suggestions.filter((s) => s.studentKey === 'Student A')
  assert.equal(a.length, 1)
  assert.equal(a[0].kind, 'modification')
  const b = body.suggestions.filter((s) => s.studentKey === 'Student B')
  assert.equal(b.length, 2, 'capped at 2 per student')
  assert.ok(b.every((s) => s.kind === 'adaptation'))
  assert.ok(!body.suggestions.some((s) => s.studentKey === 'Student C'), 'unrelated reading goal skipped in a math lesson')
  assert.ok(!body.suggestions.some((s) => s.studentKey === 'Student D'), '"paragraph" is not a math word')
})

test('bad input is rejected', async () => {
  assert.equal((await chat(srv, { ...LESSON, teacher: '../etc/passwd' })).status, 400)
  assert.equal((await chat(srv, { task: 'nope', teacher: TEACHER })).status, 400)
  const res = await fetch(`${srv.base}/chat`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ message: 'hello' }) })
  assert.equal(res.status, 400)
})

test('feedback is stored per teacher and capped at 50', async () => {
  const res = await chat(srv, { task: 'feedback', teacher: TEACHER, kind: 'adaptation', text: 'Use a first-then card.', decision: 'approved' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { response: 'ok' })
  for (let i = 0; i < 55; i++) {
    await chat(srv, { task: 'feedback', teacher: TEACHER, kind: 'adaptation', text: `item ${i}`, decision: i % 2 ? 'approved' : 'rejected' })
  }
  const { items } = JSON.parse(await readFile(join(srv.dataDir, `${TEACHER}.json`), 'utf8'))
  assert.equal(items.length, 50)
  assert.equal(items.at(-1).text, 'item 54')
  assert.equal((await chat(srv, { task: 'feedback', teacher: TEACHER, text: 'x', decision: 'maybe' })).status, 400)
})

// A fake Gemini checks the REST call, the few-shot memory and output sanitizing.
test('gemini path: few-shot feedback in, sanitized suggestions out, rules on failure', async () => {
  let seen
  let fail = false
  let bad = false
  const fake = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    seen = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(raw) }
    if (fail) { res.writeHead(500); return res.end('{}') }
    if (bad) { res.writeHead(200); return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: `{"x": ${NAME}` }] } }] })) }
    const suggestions = [
      { studentKey: 'Student A', goalId: 'g-math', kind: 'modification', text: 'x'.repeat(400), why: 'Outcome changes.' },
      { studentKey: 'Student B', goalId: 'g-reg1', kind: 'adaptation', text: 'One.', why: 'Why.' },
      { studentKey: 'Student B', goalId: 'g-reg2', kind: 'adaptation', text: 'Two.', why: 'Why.' },
      { studentKey: 'Student B', goalId: 'g-reg3', kind: 'adaptation', text: 'Three.', why: 'Why.' },
      { studentKey: 'Student Z', goalId: 'g-math', kind: 'adaptation', text: 'Ghost.', why: 'Why.' },
      { studentKey: 'Student C', goalId: 'g-read', kind: 'rewrite', text: 'Bad kind.', why: 'Why.' },
    ]
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions }) }] } }] }))
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  const g = await start({ GEMINI_API_KEY: 'fake-key', GEMINI_BASE_URL: `http://127.0.0.1:${fake.address().port}` })
  try {
    await chat(g, { task: 'feedback', teacher: TEACHER, kind: 'adaptation', text: 'Teacher liked the cube bins.', decision: 'approved' })
    const body = JSON.parse((await (await chat(g, LESSON)).json()).response)
    assert.equal(body.source, 'gemini')
    assertShape(body, KNOWN)
    assert.deepEqual(body.suggestions.map((s) => s.goalId), ['g-math', 'g-reg1', 'g-reg2'])
    assert.equal(seen.key, 'fake-key')
    assert.match(seen.url, /gemini-3\.5-flash-lite:generateContent$/)
    assert.equal(seen.body.generationConfig.responseMimeType, 'application/json')
    assert.ok(seen.body.generationConfig.responseSchema)
    assert.ok(JSON.stringify(seen.body).includes('Teacher liked the cube bins.'), 'few-shot memory sent')

    fail = true
    const fallback = JSON.parse((await (await chat(g, LESSON)).json()).response)
    assert.equal(fallback.source, 'rules')
    fail = false
    bad = true
    assert.equal(JSON.parse((await (await chat(g, LESSON)).json()).response).source, 'rules', 'invalid model JSON falls back')
    assert.ok(!g.logs().includes(NAME) && !g.logs().includes('fake-key'), 'no names or key in logs')
  } finally {
    await g.stop()
    fake.close()
  }
})
