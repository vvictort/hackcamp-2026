import { STUDENT_IDS, USER_IDS } from '../fixtures'
import type { Harness } from './harness'

/** Multi-step API flows reused by the e2e tests. Every step goes through /api/v1. */

export const { kai, amara, sofia } = STUDENT_IDS
export const U = USER_IDS
export const TODAY = '2026-11-09'

/** The bundled fictional number-facts check the demo sample sheet carries (see POST /captures/sample-sheet). */
const SAMPLE_ITEMS = [
  { id: 'q1', prompt: '4 + 3 = ?', format: 'numeric', options: null },
  { id: 'q2', prompt: '9 - 4 = ?', format: 'numeric', options: null },
  { id: 'q3', prompt: 'Which is bigger, 6 or 8?', format: 'multiple_choice', options: ['6', '8'] },
]
const SAMPLE_KEY = [
  { itemId: 'q1', accepted: ['7'] },
  { itemId: 'q2', accepted: ['5'] },
  { itemId: 'q3', accepted: ['8'] },
]

/**
 * A coded sheet with an answer key for one student. The removed /lessons routes are replaced by the dev-seed
 * sample sheet (the harness must be created with devSeed: true). The lens approval itself is POST /lens/approvals.
 */
export async function approvedMathSheets(h: Harness, studentId: string) {
  const res = await h.post(U.teacher, '/captures/sample-sheet', { studentId })
  if (res.status !== 200) throw new Error(`sample sheet ${res.status}: ${JSON.stringify(res.body)}`)
  const code = res.body.code as string
  const row = h.school.get<{ lesson_id: string }>('SELECT lesson_id FROM sheet_codes WHERE code = ?', code)
  if (!row) throw new Error('sheet code not stored')
  // The sample's adaptation is saved as a draft; the teacher's approval is what makes its check usable in student mode.
  h.studentSql(studentId).run("UPDATE suggestions SET status = 'approved' WHERE status = 'draft'")
  const lesson = { id: row.lesson_id, title: 'Sample sheet: number facts' }
  const pages = [{ sheetCode: code, checkItems: SAMPLE_ITEMS }]
  const answerKey = [{ sheetCode: code, entries: SAMPLE_KEY }]
  return { lesson, checkId: res.body.checkId as string, sheets: { pages, answerKey } }
}

/** Approves one adaptation through the Lens approval endpoint (what the dashboard posts). */
export async function approveAdaptation(h: Harness, studentId: string, over: Record<string, unknown> = {}) {
  const profile = await h.get(U.teacher, `/students/${studentId}`)
  const goal = (profile.body.goals as { id: string; status: string }[]).find((g) => g.status === 'active')
  if (!goal) throw new Error('student has no active goal')
  return h.post(U.teacher, '/lens/approvals', {
    studentId,
    subject: 'math',
    lessonText: 'Add and subtract within 10',
    items: [{ goalId: goal.id, label: 'adapt', adaptationType: 'chunked_steps', title: 'Steps', text: 'Give a step-by-step card.', why: 'Supports the goal.', ...over }],
  })
}

/** A minimal one-page PDF whose content stream shows each line with Tj and a line move. FICTIONAL text only. */
export async function fictionalPdf(lines: string[], compress = false): Promise<Uint8Array> {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const latin1 = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0))
  const content = latin1(`BT /F1 10 Tf 72 760 Td 12 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`)
  const body = compress
    ? new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
    : content
  const filter = compress ? ' /Filter /FlateDecode' : ''
  const head = latin1(
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
      '3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n' +
      `4 0 obj << /Length ${body.length}${filter} >>\nstream\n`,
  )
  const tail = latin1('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
  const out = new Uint8Array(head.length + body.length + tail.length)
  out.set(head, 0)
  out.set(body, head.length)
  out.set(tail, head.length + body.length)
  return out
}

/** Base64 of bytes, for inline uploads. */
export const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
