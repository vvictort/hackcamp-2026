// Altamyra Lesson Lens agent: a zero-dependency Node 22 server for Maritime.
// Contract: GET /health, POST /chat { message } -> { response } within 30 s.
// It only ever sees pseudonymous keys ("Student A"); real names stay in the app.
import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PORT = Number(process.env.PORT || 8080)
const DATA_DIR = process.env.DATA_DIR || '/data'
const AGENT_TOKEN = process.env.AGENT_TOKEN || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
// Model chain: next model on 429, 503, 404 or a timeout. GEMINI_MODEL (one model) still works.
const DEFAULT_MODELS = 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite'
const GEMINI_MODELS = (process.env.ALTAMYRA_GEMINI_MODELS || process.env.GEMINI_MODEL || DEFAULT_MODELS)
  .split(',').map((m) => m.trim()).filter(Boolean)
// Test seam: lets the suite point at a fake Gemini. Production leaves it unset.
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
const GEMINI_TIMEOUT_MS = 25_000
const MAX_CHARS = 300
const PER_STUDENT = 2
const MEMORY_CAP = 50
const FEW_SHOT = 6
const MAX_BODY = 256 * 1024
const TEACHER_RE = /^[A-Za-z0-9_-]{1,128}$/

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const str = (v, max = MAX_CHARS) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
// Cut at a word boundary so a clamped sentence never ends mid-word.
const clamp = (s) => {
  s = s.trim()
  if (s.length <= MAX_CHARS) return s
  const cut = s.slice(0, MAX_CHARS - 1)
  const space = cut.lastIndexOf(' ')
  return (space > 200 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '.'
}

// ---------- request parsing ----------

function parseLessonLens(req) {
  const teacher = checkTeacher(req.teacher)
  const students = (Array.isArray(req.students) ? req.students : []).slice(0, 40).map((s) => ({
    key: str(s?.key, 40),
    goals: (Array.isArray(s?.goals) ? s.goals : []).slice(0, 10).map((g) => ({
      id: str(g?.id, 80),
      area: str(g?.area, 80),
      text: str(g?.text, 600),
      level: str(g?.level, 40),
    })).filter((g) => g.id),
    accommodations: (Array.isArray(s?.accommodations) ? s.accommodations : []).slice(0, 10).map((a) => str(a, 200)).filter(Boolean),
    strengths: (Array.isArray(s?.strengths) ? s.strengths : []).slice(0, 10).map((a) => str(a, 200)).filter(Boolean),
  })).filter((s) => s.key && s.goals.length)
  return {
    teacher,
    subject: str(req.subject, 80),
    lesson: str(req.lesson, 4000),
    details: str(req.details, 4000),
    language: checkLanguage(req.language),
    students,
  }
}

// Only a plain language name reaches the prompt ("Punjabi (Gurmukhi)"), never free text.
const LANGUAGE_RE = /^[A-Za-z][A-Za-z ()-]{1,39}$/
function checkLanguage(l) {
  return typeof l === 'string' && LANGUAGE_RE.test(l.trim()) ? l.trim() : 'English'
}

function checkTeacher(t) {
  if (typeof t !== 'string' || !TEACHER_RE.test(t)) throw new HttpError(400, 'teacher must be an opaque hash')
  return t
}

// ---------- teacher memory under DATA_DIR ----------

const locks = new Map() // ponytail: in-process lock, fine for one container per agent
function withLock(key, fn) {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn)
  locks.set(key, run.catch(() => {}))
  return run
}

async function loadMemory(teacher) {
  try {
    const data = JSON.parse(await readFile(join(DATA_DIR, `${teacher}.json`), 'utf8'))
    return Array.isArray(data.items) ? data.items : []
  } catch {
    return []
  }
}

function saveFeedback(req) {
  const teacher = checkTeacher(req.teacher)
  const decision = req.decision
  if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'decision must be approved or rejected')
  const item = { kind: str(req.kind, 40), text: str(req.text), decision, at: new Date().toISOString() }
  if (!item.text) throw new HttpError(400, 'text is required')
  return withLock(teacher, async () => {
    const items = [...(await loadMemory(teacher)), item].slice(-MEMORY_CAP)
    await mkdir(DATA_DIR, { recursive: true })
    const file = join(DATA_DIR, `${teacher}.json`)
    await writeFile(`${file}.tmp`, JSON.stringify({ items }))
    await rename(`${file}.tmp`, file)
  })
}

// ---------- rules fallback ----------

const TOPICS = {
  // Word-start anchors so "paragraph" is not math (graph) and "individual" is not math (divi).
  math: /\b(math|numera|number|multipl|divi|fraction|add|subtract|count|array|geometr|measur|pattern|graph)/i,
  reading: /\b(read|literac|phonic|decod|comprehen|main idea|story|book|text|vocab)/i,
  writing: /\b(writ|journal|spell|handwrit|sentence|paragraph|notes|fine motor|printing)/i,
  science: /\b(scien|salmon|ecosystem|experiment|plant|animal|weather|habitat|inquiry|field)/i,
}
// Goals like these apply to any lesson.
const GENERAL = /self-reg|regulat|attention|focus|behav|social|emotion|executive|organi|transition|communicat|speech|language|independ|work habit|on.task/i

const lessonTopics = (l) => {
  const hay = `${l.subject} ${l.lesson} ${l.details}`
  return Object.keys(TOPICS).filter((t) => TOPICS[t].test(hay))
}
const goalTopic = (g) => Object.keys(TOPICS).find((t) => TOPICS[t].test(g.area))
  ?? (GENERAL.test(`${g.area} ${g.text}`) ? 'general' : Object.keys(TOPICS).find((t) => TOPICS[t].test(g.text)))

function rulesSuggest(l) {
  const topics = lessonTopics(l)
  const lesson = l.lesson || l.subject || 'this lesson'
  const out = []
  for (const s of l.students) {
    let n = 0
    for (const g of s.goals) {
      if (n >= PER_STUDENT) break
      const topic = goalTopic(g)
      if (topic !== 'general' && !topics.includes(topic)) continue
      const modified = /modif/i.test(g.area)
      const goal = g.text.replace(/[.\s]+$/, '')
      let text, why
      if (modified) {
        text = `Set an individual target for "${lesson}" built on the modified goal, with concrete materials, and assess against that goal instead of the class outcome.`
        why = `The goal is modified, so the learning outcome changes: ${goal}.`
      } else {
        text = {
          math: `Keep the class outcome for "${lesson}" and add supports: manipulatives, one worked example and fewer questions on the page.`,
          reading: `Offer a read-aloud or text-to-speech version of the "${lesson}" text and a sentence starter for the response.`,
          writing: `Let the student dictate or use speech-to-text for the written part of "${lesson}", then copy two key sentences.`,
          science: `Give a picture-supported step card for "${lesson}" and let the student record findings with labels or a voice note.`,
          general: `Post a first-then card with the steps of "${lesson}", check in after the first step and plan one movement break.`,
        }[topic]
        why = `Same outcome as the class, with a support for this goal: ${goal}.`
      }
      out.push({ studentKey: s.key, goalId: g.id, kind: modified ? 'modification' : 'adaptation', text: clamp(text), why: clamp(why) })
      n++
    }
  }
  return out
}

// ---------- Gemini ----------

const SYSTEM = `You help a BC (Canada) grade-school teacher adapt one lesson for students with IEP goals.
For each student whose goals relate to the lesson, suggest at most 2 concrete actions the teacher can take in this lesson.
Also list gaps: where the student may get stuck in this lesson. Each gap has a type (access, skill, behaviour, engagement or communication), the goalId it relates to and one sentence of text.
Each suggestion names the goalId it serves. Skip students whose goals do not relate to the lesson.
kind is "modification" ONLY when the learning outcome itself changes for the student (BC definition: modified outcomes differ from the curriculum's learning standards); otherwise "adaptation" (same outcome, changed support, materials, time or format).
"text" is one concrete teacher action, at most 300 characters. "why" is one sentence tied to the goal, at most 300 characters.
Use Canadian spelling. Do not use em dashes. Refer to students only by the key given. Never invent names.
teacherFeedback lists this teacher's recent approved and rejected suggestions: write more like the approved ones, avoid what was rejected.`

const GAP_TYPES = ['access', 'skill', 'behaviour', 'engagement', 'communication']
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          studentKey: { type: 'STRING' },
          goalId: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['adaptation', 'modification'] },
          text: { type: 'STRING' },
          why: { type: 'STRING' },
        },
        required: ['studentKey', 'goalId', 'kind', 'text', 'why'],
      },
    },
  },
  required: ['suggestions'],
}
RESPONSE_SCHEMA.properties.gaps = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      studentKey: { type: 'STRING' },
      goalId: { type: 'STRING' },
      type: { type: 'STRING', enum: GAP_TYPES },
      text: { type: 'STRING' },
    },
    required: ['studentKey', 'goalId', 'type', 'text'],
  },
}

// Gemini writes "text" and "why" in the teacher's language. Keys, goal ids and kind stay exactly as given.
const languageRule = (language) =>
  language === 'English'
    ? ''
    : `Write "text" and "why" in ${language}. Keep studentKey, goalId and kind exactly as given: studentKey values such as "Student A" and the kind values "adaptation" and "modification" are never translated.\n`

async function geminiSuggest(l, memory) {
  const teacherFeedback = memory.filter((m) => m.decision === 'approved' || m.decision === 'rejected')
    .slice(-FEW_SHOT).map(({ kind, text, decision }) => ({ kind, text, decision }))
  const input = { subject: l.subject, lesson: l.lesson, details: l.details, students: l.students, teacherFeedback }
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: languageRule(l.language) + SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  })
  let lastErr = new Error('no gemini model answered')
  for (const model of GEMINI_MODELS) {
    let res
    try {
      res = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      })
    } catch (e) {
      lastErr = e // timeout or network: next model
      continue
    }
    if (res.status === 429 || res.status === 503 || res.status === 404 || res.status >= 500) {
      lastErr = new Error(`gemini http ${res.status}`)
      continue
    }
    if (!res.ok) throw new Error(`gemini http ${res.status}`)
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.find((p) => typeof p?.text === 'string')?.text
    if (!text) throw new Error('gemini returned no text')
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed?.suggestions)) throw new Error('gemini returned no suggestions array')
    return parsed
  }
  throw lastErr
}

// Never trust model output: keep only known student/goal pairs, the two kinds,
// the length limits and the per-student cap.
function sanitizeGaps(raw, l) {
  const goals = new Map(l.students.map((s) => [s.key, new Set(s.goals.map((g) => g.id))]))
  const out = []
  for (const g of Array.isArray(raw) ? raw : []) {
    if (!goals.get(g?.studentKey)?.has(g?.goalId) || !GAP_TYPES.includes(g.type)) continue
    const text = typeof g.text === 'string' ? clamp(g.text) : ''
    if (text) out.push({ studentKey: g.studentKey, goalId: g.goalId, type: g.type, text })
  }
  return out.slice(0, 80)
}

function sanitize(raw, l) {
  const goals = new Map(l.students.map((s) => [s.key, new Set(s.goals.map((g) => g.id))]))
  const count = new Map()
  const out = []
  for (const s of raw) {
    const key = s?.studentKey
    if (!goals.get(key)?.has(s?.goalId)) continue
    if (s.kind !== 'adaptation' && s.kind !== 'modification') continue
    const text = typeof s.text === 'string' ? clamp(s.text) : ''
    const why = typeof s.why === 'string' ? clamp(s.why) : ''
    if (!text || !why) continue
    if ((count.get(key) ?? 0) >= PER_STUDENT) continue
    count.set(key, (count.get(key) ?? 0) + 1)
    out.push({ studentKey: key, goalId: s.goalId, kind: s.kind, text, why })
  }
  return out
}

async function lessonLens(req) {
  const l = parseLessonLens(req)
  if (GEMINI_API_KEY) {
    try {
      const parsed = await geminiSuggest(l, await loadMemory(l.teacher))
      return { suggestions: sanitize(parsed.suggestions, l), gaps: sanitizeGaps(parsed.gaps, l), source: 'gemini' }
    } catch (e) {
      // Status or error name only: never the prompt, the body or the key.
      // A SyntaxError message quotes the model's text, which echoes goal text: log its name only.
      const why = e?.name === 'TimeoutError' ? 'timeout' : e instanceof SyntaxError ? 'invalid JSON' : e?.message?.slice(0, 80)
      console.warn(`gemini failed (${why}), using rules`)
    }
  }
  return { suggestions: rulesSuggest(l), source: 'rules' }
}

// ---------- HTTP ----------

const digest = (s) => createHash('sha256').update(s).digest()
const authorized = (header) => !AGENT_TOKEN || timingSafeEqual(digest(header ?? ''), digest(`Bearer ${AGENT_TOKEN}`))

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw new HttpError(413, 'request too large')
    chunks.push(c)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'body must be JSON') }
}

async function chat(req) {
  const body = await readJson(req)
  if (typeof body?.message !== 'string') throw new HttpError(400, 'message must be a string')
  let msg
  try { msg = JSON.parse(body.message) } catch { throw new HttpError(400, 'message must be a JSON lesson-lens or feedback request') }
  if (msg?.task === 'lesson-lens') return JSON.stringify(await lessonLens(msg))
  if (msg?.task === 'feedback') { await saveFeedback(msg); return 'ok' }
  throw new HttpError(400, 'unknown task')
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  const path = (req.url ?? '').split('?')[0]
  let status = 200
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true })
    if (req.method === 'POST' && path === '/chat') {
      if (!authorized(req.headers.authorization)) { status = 401; return send(res, 401, { error: 'unauthorized' }) }
      return send(res, 200, { response: await chat(req) })
    }
    status = 404
    send(res, 404, { error: 'not found' })
  } catch (e) {
    status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(`internal error: ${e?.code ?? e?.name}`) // e.g. EACCES on /data
    send(res, status, { error: status === 500 ? 'internal error' : e.message })
  } finally {
    if (path !== '/health') console.log(`${req.method} ${path} ${status} ${Date.now() - started}ms`)
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`lesson-lens listening on ${server.address().port} (gemini ${GEMINI_API_KEY ? 'on' : 'off'}, auth ${AGENT_TOKEN ? 'on' : 'off'})`)
})
