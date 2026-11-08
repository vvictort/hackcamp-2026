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
import type { MessageKey } from '@/i18n/en'

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

const ERRORS: Record<string, MessageKey> = {
  agent_not_configured: 'app.home.lensNotConnected',
  agent_unreachable: 'app.home.lensNoAnswer',
  agent_bad_reply: 'app.home.lensBadReply',
  not_found: 'app.home.lensNotFound',
  unauthorized: 'app.home.lensSignedOut',
}

export function useLessonLens() {
  const { user } = useUser()
  const { t } = useLang()
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
    (code?: string) => toast.error(t(ERRORS[code ?? ''] ?? 'app.home.lensFailed')),
    [toast, t],
  )

  const suggest = useCallback(
    async (id: string, details?: string) => {
      setSuggesting(id)
      try {
        const r = await callAction<{ created: number; source: string }>('lessonLensSuggest', { classBlockId: id, details })
        if (!r.success) return fail(r.code)
        const n = r.data.created
        if (n === 0) toast.info(t('app.home.lensNoneTitle'), t('app.home.lensNoneBody'))
        else toast.success(n === 1 ? t('app.home.lensAddedOne') : t('app.home.lensAddedMany', { n }))
      } finally {
        setSuggesting(null)
      }
    },
    [fail, toast, t],
  )

  const decide = useCallback(
    async (id: string, decision: Decision) => {
      setDeciding(id)
      try {
        const r = await callAction<{ state: Decision }>('lessonLensFeedback', { suggestionId: id, decision })
        if (!r.success) return fail(r.code)
        toast.success(decision === 'approved' ? t('app.home.lensApproved') : t('app.home.lensRejected'))
      } finally {
        setDeciding(null)
      }
    },
    [fail, toast, t],
  )

  return { pending, classBlockId, suggest, decide, suggesting, deciding }
}
