import { useState } from 'react'
import { Check, FileText, Languages, Pencil } from 'lucide-react'
import { Button, Card, StatusBadge, Textarea, useToast } from '@/components/ui'
import { ApiError, markDraftUsed, patchDraft, type ProgressDraft } from '@/lib/altamira/drafts-api'
import type { DraftsKey } from '@/i18n/en/drafts'
import { FamilyBridgeDialog } from './FamilyBridgeDialog'
import { SourceDialog } from './SourceDialog'
import { useDraftsT } from './useDraftsT'

const TONE = { draft: 'info', edited: 'warning', used: 'success' } as const

/** One Progress Draft: claims with citation chips, inline edit, mark used, family summary. */
export function DraftCard({ draft, studentId, goalText, onChange }: { draft: ProgressDraft; studentId: string; goalText?: string; onChange: (d: ProgressDraft) => void }) {
  const t = useDraftsT()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [texts, setTexts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [bridge, setBridge] = useState(false)

  const fail = (e: unknown) =>
    setError(e instanceof ApiError && e.status === 409 ? t('drafts.conflict') : e instanceof ApiError ? e.message : t('drafts.saveFailed'))

  const startEdit = () => {
    setTexts(draft.sentences.map((s) => s.text))
    setEditing(true)
    setError(null)
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const sentences = draft.sentences.map((s, i) => ({ ...s, text: texts[i]?.trim() || s.text }))
      const { draft: d } = await patchDraft(draft.id, studentId, sentences, draft.version)
      onChange(d)
      setEditing(false)
      toast.success(t('drafts.saved'))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const markUsed = async () => {
    setBusy(true)
    setError(null)
    try {
      const { draft: d } = await markDraftUsed(draft.id, studentId, draft.version)
      onChange(d)
      toast.success(t('drafts.markedUsed'))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={goalText ? `${draft.period}: ${goalText}` : draft.period}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={TONE[draft.status]}>{t(`drafts.status.${draft.status}` as DraftsKey)}</StatusBadge>
        {draft.proficiencySuggestion && (
          <span className="text-small text-muted-foreground">{t('drafts.proficiency', { level: draft.proficiencySuggestion })}</span>
        )}
      </div>
      <ol className="flex flex-col gap-4">
        {draft.sentences.map((s, i) => (
          <li key={i} className="flex flex-col gap-2">
            {editing ? (
              <Textarea
                aria-label={t('drafts.claim', { n: i + 1 })}
                value={texts[i] ?? ''}
                onChange={(e) => setTexts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                rows={3}
              />
            ) : (
              <p className="text-body">{s.text}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {s.citations.length === 0 ? (
                <span className="text-small text-muted-foreground">{t('drafts.noCitation')}</span>
              ) : (
                s.citations.map((id, j) => (
                  <Button
                    key={id}
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    aria-label={t('drafts.citationOpen', { n: j + 1, claim: i + 1 })}
                    onClick={() => setSource(id)}
                  >
                    <FileText aria-hidden />
                    {t('drafts.citation', { n: j + 1 })}
                  </Button>
                ))
              )}
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {editing ? (
          <>
            <Button onClick={save} loading={busy}>
              {t('drafts.save')}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              {t('drafts.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={startEdit} disabled={busy || draft.status === 'used'}>
              <Pencil aria-hidden />
              {t('drafts.edit')}
            </Button>
            <Button onClick={markUsed} loading={busy} disabled={draft.status === 'used'}>
              <Check aria-hidden />
              {t('drafts.markUsed')}
            </Button>
            <Button variant="outline" onClick={() => setBridge(true)}>
              <Languages aria-hidden />
              {t('drafts.familySummary')}
            </Button>
          </>
        )}
      </div>
      <SourceDialog dataPointId={source} onClose={() => setSource(null)} />
      <FamilyBridgeDialog draftId={draft.id} studentId={studentId} open={bridge} onClose={() => setBridge(false)} />
    </Card>
  )
}
