import { FIXTURE_LESSONS } from '../ai/fixture-data'
import { CLASS_IDS, STUDENT_IDS, USER_IDS } from '../fixtures'
import type { Harness } from './harness'

/** Multi-step API flows reused by the e2e tests. Every step goes through /api/v1. */

export const { kai, amara, sofia } = STUDENT_IDS
export const U = USER_IDS
export const TODAY = '2026-11-09'

export async function createLesson(h: Harness, kind: 'literacy' | 'numeracy') {
  const classId = kind === 'literacy' ? CLASS_IDS.literacy : CLASS_IDS.numeracy
  const source = kind === 'literacy' ? FIXTURE_LESSONS.literacy : FIXTURE_LESSONS.numeracy
  const res = await h.post(U.teacher, `/classes/${classId}/lessons`, {
    title: source.title,
    sourceKind: 'text',
    text: source.text,
    scheduledFor: TODAY,
  })
  if (res.status !== 201) throw new Error(`lesson create ${res.status}: ${JSON.stringify(res.body)}`)
  return res.body.lesson as { id: string; title: string }
}

export async function runLens(h: Harness, lessonId: string) {
  const res = await h.post(U.teacher, `/lessons/${lessonId}/lens`, {})
  if (res.status !== 200) throw new Error(`lens ${res.status}: ${JSON.stringify(res.body)}`)
  return res.body as { analysisId: string; results: { studentId: string; suggestions: any[]; checks: any[] }[] }
}

/** Math lesson, lens, approve every unblocked adaptation for one student, then print sheets. */
export async function approvedMathSheets(h: Harness, studentId: string) {
  const lesson = await createLesson(h, 'numeracy')
  const lens = await runLens(h, lesson.id)
  const result = lens.results.find((r) => r.studentId === studentId)
  if (!result) throw new Error('student missing from lens results')
  const items = result.suggestions
    .filter((s) => s.kind === 'adaptation' && s.status !== 'blocked')
    .map((s) => ({ suggestionId: s.id, expectedVersion: s.version }))
  const bulk = await h.post(U.teacher, `/students/${studentId}/suggestions/bulk-approve`, { items })
  if (bulk.status !== 200) throw new Error(`bulk approve ${bulk.status}: ${JSON.stringify(bulk.body)}`)
  const sheets = await h.get(U.teacher, `/lessons/${lesson.id}/sheets/${studentId}`)
  if (sheets.status !== 200) throw new Error(`sheets ${sheets.status}: ${JSON.stringify(sheets.body)}`)
  return { lesson, result, sheets: sheets.body as { pages: any[]; answerKey: { sheetCode: string; entries: { itemId: string; accepted: string[] }[] }[] } }
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
