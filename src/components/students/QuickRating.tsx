import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { recordEvent } from '@/lib/altamyra/capture-api'
import { QUICK_RATINGS, ratingEvent, type QuickRating as Rating } from '@/lib/altamyra/profile-api'
import type { Objective } from '@/server/altamyra/contract/student'
import { useLang } from '@/i18n'

/** One-tap rating for a goal: records a data point on the goal's confirmed objective. */
export function QuickRating({ studentId, objective, onSaved }: { studentId: string; objective: Objective | undefined; onSaved: () => void }) {
  const { t } = useLang()
  const toast = useToast()
  const [busy, setBusy] = useState<Rating | null>(null)
  const [last, setLast] = useState<Rating | null>(null)

  if (!objective || objective.status !== 'confirmed') {
    return <p className="text-small text-muted-foreground">{t('students.rate.noObjective')}</p>
  }
  if (ratingEvent(objective, 'got_it') === null) return <p className="text-small text-muted-foreground">{t('students.rate.none')}</p>

  const rate = async (r: Rating) => {
    const event = ratingEvent(objective, r)
    if (!event) return
    setBusy(r)
    try {
      await recordEvent(studentId, event)
      setLast(r)
      toast.success(t('students.rate.saved', { rating: t(`students.rate.${r}` as const) }))
      onSaved()
    } catch (e) {
      toast.error(t('students.error.action'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label font-semibold" id={`rate-${objective.id}`}>{t('students.rate.label')}</h3>
      <div role="group" aria-labelledby={`rate-${objective.id}`} className="flex flex-wrap gap-2">
        {QUICK_RATINGS.map((r) => {
          const disabled = ratingEvent(objective, r) === null
          return (
            <Button key={r} variant={last === r ? 'default' : 'outline'} size="sm" disabled={disabled || busy !== null} loading={busy === r} onClick={() => rate(r)}>
              {last === r && <Check aria-hidden />}
              {t(`students.rate.${r}` as const)}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
