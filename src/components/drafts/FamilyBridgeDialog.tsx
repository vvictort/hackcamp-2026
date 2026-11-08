import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui'
import { LANGUAGES } from '@/i18n/languages'
import { approveFamilySummary, createFamilySummary, ApiError, type FamilySummary } from '@/lib/altamira/drafts-api'
import { ReadAloudButton } from '@/components/ReadAloudButton'
import { useDraftsT } from './useDraftsT'

/** Family Bridge: plain-language summary from a draft, language pick, browser audio, approve. */
export function FamilyBridgeDialog({ draftId, open, onClose }: { draftId: string; open: boolean; onClose: () => void }) {
  const t = useDraftsT()
  const toast = useToast()
  const [language, setLanguage] = useState('en')
  const [summary, setSummary] = useState<FamilySummary | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'make' | 'approve' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const make = async () => {
    setBusy('make')
    setError(null)
    try {
      const { summary: s } = await createFamilySummary(draftId, language)
      setSummary(s)
      setText(s.text)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('drafts.fb.failed'))
    } finally {
      setBusy(null)
    }
  }

  const approve = async () => {
    if (!summary) return
    setBusy('approve')
    setError(null)
    try {
      const { summary: s } = await approveFamilySummary(summary.id, summary.version, text !== summary.text ? text : undefined)
      setSummary(s)
      setText(s.text)
      toast.success(t('drafts.fb.approvedToast'))
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('drafts.conflict') : e instanceof ApiError ? e.message : t('drafts.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const approved = summary?.status === 'approved'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('drafts.fb.title')}</DialogTitle>
          <DialogDescription>{t('drafts.fb.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t('drafts.fb.language')}</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger aria-label={t('drafts.fb.language')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.native}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={make} loading={busy === 'make'} disabled={busy !== null} variant={summary ? 'outline' : 'default'}>
            {busy === 'make' ? t('drafts.fb.making') : t('drafts.fb.make')}
          </Button>
          {summary && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="fb-text">{t('drafts.fb.text')}</Label>
                <StatusBadge tone={approved ? 'success' : 'warning'}>{approved ? t('drafts.fb.approved') : t('drafts.fb.pending')}</StatusBadge>
              </div>
              <Textarea id="fb-text" value={text} onChange={(e) => setText(e.target.value)} readOnly={approved} rows={6} />
              <div className="flex flex-wrap gap-3">
                {open && <ReadAloudButton text={text} lang={summary.language} />}
                {!approved && (
                  <Button onClick={approve} loading={busy === 'approve'} disabled={busy !== null || !text.trim()}>
                    {t('drafts.fb.approve')}
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-body text-destructive">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
