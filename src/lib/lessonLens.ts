/**
 * Lesson Lens on the client: asks the worker for suggestions on one class
 * (action lessonLensSuggest) and records the teacher's decision
 * (lessonLensFeedback). The worker does the de-identifying; nothing here
 * sends student data. Pending rows are read straight from the teacher's own
 * suggestions, so approved and rejected ones drop off the list.
 */

import { useCallback, useMemo, useState } from 'react'
import { getAuthToken, useQuery, useUser } from 'deepspace'
import { useToast } from '@/components/ui'
import { useLang } from '@/i18n'
import { lens, type LensKey } from '@/i18n/en/lens'
import { removeCheck as removeCheckPure, type LessonAnalysis, type LensSuggestionView, type StudentAnalysis } from '@/actions/lesson-lens-core'

export { removeCheckPure as removeCheck }
export type { LessonAnalysis, LensSuggestionView, StudentAnalysis }

/** English lens strings with {vars}; swap for t() once lens.ts is registered in en.ts. */
export function lensText(key: LensKey, vars?: Record<string, string | number>): string {
  const text: string = lens[key]
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

export type Decision = 'approved' | 'rejected'

export interface PendingSuggestion {
  id: string
  studentId: string
  goalId: string
  lesson: string
  kind: 'adaptation' | 'modification'
  text: string
  why: string
}

interface SuggestionRow { ownerId?: string; studentKey: string; goalId: string; lesson: string; kind: PendingSuggestion['kind']; text: string; why: string; state: string }
interface ClassRow { ownerId?: string; time: string; subject: string; lesson: string }

type Result<T> = { success: true; data: T } | { success: false; error: string; code?: string }

async function callAction<T>(name: string, params: Record<string, unknown>): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await getAuthToken()) ?? ''}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as Result<T> | null
    if (body && typeof body.success === 'boolean') return body
    return { success: false, error: `HTTP ${res.status}`, code: res.status === 401 ? 'unauthorized' : 'network' }
  } catch {
    return { success: false, error: 'network', code: 'network' }
  }
}

const ERRORS: Record<string, LensKey> = {
  agent_not_configured: 'lens.err.agent_unreachable',
  agent_unreachable: 'lens.err.agent_unreachable',
  agent_bad_reply: 'lens.err.agent_bad_reply',
  not_found: 'lens.err.not_found',
  unauthorized: 'lens.err.unauthorized',
}

export function useLessonLens() {
  const { user } = useUser()
  const { lang } = useLang()
  const toast = useToast()
  const ownerId = user?.id ?? ''
  const rows = useQuery<SuggestionRow>('suggestions', { where: { ownerId, state: 'pending' } })
  const blocks = useQuery<ClassRow>('classBlocks', { where: { ownerId }, orderBy: 'sort', orderDir: 'asc' })
  const [suggesting, setSuggesting] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)

  const pending = useMemo(
    () =>
      rows.records
        .filter((r) => r.data.ownerId === ownerId && r.data.state === 'pending')
        .map((r): PendingSuggestion => ({ id: r.recordId, studentId: r.data.studentKey, goalId: r.data.goalId, lesson: r.data.lesson, kind: r.data.kind, text: r.data.text, why: r.data.why })),
    [rows.records, ownerId],
  )

  /** useClassroom's classes carry no record id; find it by position, checked against time and lesson. */
  const classBlockId = useCallback(
    (index: number, c: { time: string; lesson: string }) => {
      const own = blocks.records.filter((r) => r.data.ownerId === ownerId)
      const same = (r: (typeof own)[number]) => r.data.time === c.time && r.data.lesson === c.lesson
      return (own[index] && same(own[index]) ? own[index] : own.find(same))?.recordId
    },
    [blocks.records, ownerId],
  )

  const fail = useCallback(
    (code?: string) => toast.error(lensText(ERRORS[code ?? ''] ?? 'lens.err.generic')),
    [toast],
  )

  const suggest = useCallback(
    async (id: string, details?: string) => {
      setSuggesting(id)
      try {
        const r = await callAction<{ created: number; source: string }>('lessonLensSuggest', { classBlockId: id, details, language: lang })
        if (!r.success) return fail(r.code)
        const n = r.data.created
        if (n > 0) toast.success(lensText('lens.toast.saved'))
      } finally {
        setSuggesting(null)
      }
    },
    [fail, toast, lang],
  )

  const decide = useCallback(
    async (id: string, decision: Decision) => {
      setDeciding(id)
      try {
        const r = await callAction<{ state: Decision }>('lessonLensFeedback', { suggestionId: id, decision })
        if (!r.success) return fail(r.code)
        toast.success(lensText(decision === 'approved' ? 'lens.toast.approved' : 'lens.toast.rejected'))
      } finally {
        setDeciding(null)
      }
    },
    [fail, toast],
  )

  return { pending, classBlockId, suggest, decide, suggesting, deciding }
}

export interface AnalyzeInput {
  lessonText: string
  subject?: string
  studentIds?: string[]
}

/** 1A: analyze a lesson, then review each suggestion. The analysis lives in page state; the worker caches and saves rows. */
export function useLensAnalysis() {
  const { lang } = useLang()
  const toast = useToast()
  const [analysis, setAnalysis] = useState<LessonAnalysis | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState<AnalyzeInput | null>(null)

  const fail = useCallback((code?: string) => toast.error(lensText(ERRORS[code ?? ''] ?? 'lens.err.generic')), [toast])

  const patch = useCallback((id: string, p: Partial<LensSuggestionView>) => {
    setAnalysis((a) =>
      a && { ...a, students: a.students.map((st) => ({ ...st, suggestions: st.suggestions.map((s) => (s.id === id ? { ...s, ...p } : s)) })) },
    )
  }, [])

  const analyze = useCallback(
    async (input: AnalyzeInput) => {
      setRunning(true)
      try {
        const r = await callAction<LessonAnalysis>('lessonLensAnalyze', { ...input, language: lang })
        if (!r.success) return fail(r.code)
        setAnalysis(r.data)
        setLast(input)
      } finally {
        setRunning(false)
      }
    },
    [fail, lang],
  )

  const decide = useCallback(
    async (id: string, decision: Decision, quiet = false) => {
      setBusy(id)
      try {
        const r = await callAction<{ state: Decision }>('lessonLensFeedback', { suggestionId: id, decision })
        if (!r.success) return fail(r.code), false
        patch(id, { state: decision })
        if (!quiet) toast.success(lensText(decision === 'approved' ? 'lens.toast.approved' : 'lens.toast.rejected'))
        return true
      } finally {
        setBusy(null)
      }
    },
    [fail, patch, toast],
  )

  const approveAll = useCallback(
    async (student: StudentAnalysis) => {
      const todo = student.suggestions.filter((s) => s.id && s.state === 'pending')
      const done = await Promise.all(todo.map((s) => decide(s.id, 'approved', true)))
      const n = done.filter(Boolean).length
      if (n) toast.success(lensText('lens.toast.approvedMany', { n }))
    },
    [decide, toast],
  )

  const edit = useCallback(
    async (id: string, text: string) => {
      setBusy(id)
      try {
        const r = await callAction<{ text: string }>('lessonLensEdit', { suggestionId: id, text })
        if (!r.success) return fail(r.code), false
        patch(id, { text: r.data.text })
        toast.success(lensText('lens.toast.saved'))
        return true
      } finally {
        setBusy(null)
      }
    },
    [fail, patch, toast],
  )

  const regenerate = useCallback(
    async (id: string) => {
      if (!last) return
      setBusy(id)
      try {
        const r = await callAction<LensSuggestionView>('lessonLensRegenerate', { suggestionId: id, lessonText: last.lessonText, subject: analysis?.subject, language: lang })
        if (!r.success) return fail(r.code)
        patch(id, r.data)
        toast.success(lensText('lens.toast.regenerated'))
      } finally {
        setBusy(null)
      }
    },
    [analysis?.subject, fail, lang, last, patch, toast],
  )

  const dropCheck = useCallback((studentId: string, code: string) => setAnalysis((a) => a && removeCheckPure(a, studentId, code)), [])

  return { analysis, running, busy, analyze, decide, approveAll, edit, regenerate, dropCheck }
}
