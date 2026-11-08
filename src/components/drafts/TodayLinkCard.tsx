import { useState } from 'react'
import { Copy, Link2 } from 'lucide-react'
import { Button, Card, Input, Label, useToast } from '@/components/ui'
import { ApiError, createTodayLink, todayUrl } from '@/lib/altamira/drafts-api'
import { useDraftsT } from './useDraftsT'

/** Teacher creates a no-login substitute link for one student, then copies it. */
export function TodayLinkCard({ studentId }: { studentId: string }) {
  const t = useDraftsT()
  const toast = useToast()
  const [hours, setHours] = useState('12')
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const h = Math.min(24, Math.max(1, Number(hours) || 12))
      const r = await createTodayLink(studentId, h)
      setLink({ url: todayUrl(r.token), expiresAt: r.expiresAt })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('drafts.today.failed'))
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast.success(t('drafts.today.copied'))
    } catch {
      toast.warning(t('drafts.today.copyFailed'))
    }
  }

  return (
    <Card title={t('drafts.today.title')}>
      <p className="text-body text-muted-foreground">{t('drafts.today.description')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="today-hours">{t('drafts.today.hours')}</Label>
          <Input id="today-hours" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(e.target.value)} className="w-28" />
        </div>
        <Button onClick={create} loading={busy}>
          <Link2 aria-hidden />
          {t('drafts.today.create')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      )}
      {link && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="today-link">{t('drafts.today.link')}</Label>
          <div className="flex flex-wrap gap-3">
            <Input id="today-link" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1" />
            <Button variant="outline" onClick={copy}>
              <Copy aria-hidden />
              {t('drafts.today.copy')}
            </Button>
          </div>
          <p className="text-small text-muted-foreground">{t('drafts.today.expires', { time: new Date(link.expiresAt).toLocaleString() })}</p>
        </div>
      )}
    </Card>
  )
}
