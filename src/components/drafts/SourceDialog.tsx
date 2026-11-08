import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, StatusBadge } from '@/components/ui'
import { getDataPointSource, type DataPointSource } from '@/lib/altamira/drafts-api'
import type { DraftsKey } from '@/i18n/en/drafts'
import { useDraftsT } from './useDraftsT'

/** Opens the cited data point's source. Loads when `dataPointId` is set. */
export function SourceDialog({ dataPointId, onClose }: { dataPointId: string | null; onClose: () => void }) {
  const t = useDraftsT()
  const [state, setState] = useState<{ id: string; data?: DataPointSource; failed?: boolean } | null>(null)

  useEffect(() => {
    if (!dataPointId) return
    let live = true
    getDataPointSource(dataPointId)
      .then((data) => live && setState({ id: dataPointId, data }))
      .catch(() => live && setState({ id: dataPointId, failed: true }))
    return () => {
      live = false
    }
  }, [dataPointId])

  const cur = state && state.id === dataPointId ? state : null
  const dp = cur?.data?.dataPoint
  return (
    <Dialog open={dataPointId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('drafts.sourceTitle')}</DialogTitle>
          <DialogDescription>{dp ? `${dp.value} ${dp.unit}` : ''}</DialogDescription>
        </DialogHeader>
        {!cur && (
          <p role="status" className="text-body text-muted-foreground">
            {t('drafts.sourceLoading')}
          </p>
        )}
        {cur?.failed && (
          <p role="alert" className="text-body text-destructive">
            {t('drafts.sourceFailed')}
          </p>
        )}
        {dp && cur?.data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
            <dt className="text-muted-foreground">{t('drafts.sourceKind')}</dt>
            <dd>{t(`drafts.source.${cur.data.source.kind}` as DraftsKey)}</dd>
            <dt className="text-muted-foreground">{t('drafts.sourceValue')}</dt>
            <dd>
              {dp.value} {dp.unit}
            </dd>
            <dt className="text-muted-foreground">{t('drafts.sourceRecorded')}</dt>
            <dd>{new Date(dp.recordedAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">{t('drafts.sourceStatus')}</dt>
            <dd>
              <StatusBadge tone={dp.status === 'confirmed' ? 'success' : 'info'}>{dp.status}</StatusBadge>
            </dd>
            {cur.data.source.kind === 'teacher' && cur.data.source.note && (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd>{cur.data.source.note}</dd>
              </>
            )}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}
