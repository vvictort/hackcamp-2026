import { useAsyncResource, integration } from 'deepspace'
import { CircleX, TriangleAlert } from 'lucide-react'
import { useLang } from '@/i18n'
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui'

interface IntegrationCatalog {
  integrations?: Record<string, unknown> | unknown[]
}

export default function ApiStatusPage() {
  const { t } = useLang()
  const catalog = useAsyncResource<IntegrationCatalog>(
    async (signal) => {
      const res = await integration.get<IntegrationCatalog>('', undefined, { signal })
      if (!res.success) throw new Error(res.error)
      return res.data ?? {}
    },
    [],
    { retry: 1, retryDelayMs: 500 },
  )

  const integrationCount = Array.isArray(catalog.data?.integrations)
    ? catalog.data.integrations.length
    : Object.keys(catalog.data?.integrations ?? {}).length

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('app.api.title')} description={t('app.api.description')} />

      <div className="stagger-rise flex flex-col gap-6 lg:gap-8">
        {catalog.error && catalog.data && (
          <div role="status" className="flex gap-3 rounded-lg border-2 border-warning bg-card p-6">
            <TriangleAlert className="size-6 shrink-0" aria-hidden />
            <div className="flex flex-col gap-2">
              <p className="text-label font-semibold">{t('app.api.stale')}</p>
              <p className="text-small text-muted-foreground">{catalog.error}</p>
            </div>
          </div>
        )}

        {/* One persistent slot, so swapping loading for the result does not
            replay the entrance. */}
        <div className="flex flex-col">
          {catalog.status === 'loading' ? (
            <Card role="status" className="flex-row items-center justify-center gap-3 text-small text-muted-foreground">
              <Spinner />
              {t('app.api.loading')}
            </Card>
          ) : catalog.status === 'error' ? (
            <div role="alert" className="flex gap-3 rounded-lg border-2 border-destructive bg-card p-6">
              <CircleX className="size-6 shrink-0" aria-hidden />
              <div className="flex flex-col gap-2">
                <p className="text-label font-semibold">{t('app.api.failed')}</p>
                <p className="text-small text-muted-foreground">{catalog.error}</p>
                {catalog.retryCount > 0 && (
                  <p className="text-small text-muted-foreground">
                    {catalog.retryCount === 1 ? t('app.api.retriedOne') : t('app.api.retriedMany', { n: catalog.retryCount })}
                  </p>
                )}
                <Button variant="outline" className="mt-3 self-start" onClick={catalog.reload}>
                  {t('app.api.retry')}
                </Button>
              </div>
            </div>
          ) : integrationCount === 0 ? (
            <Card>
              <EmptyState
                className="py-10"
                title={t('app.api.noneTitle')}
                description={t('app.api.noneBody')}
              />
            </Card>
          ) : (
            <Card title={t('app.api.ready')}>
              <p className="text-small text-muted-foreground">
                {integrationCount === 1 ? t('app.api.countOne') : t('app.api.countMany', { n: integrationCount })}
              </p>
              {catalog.isRefreshing && (
                <p role="status" className="text-small text-muted-foreground">
                  {t('app.api.refreshing')}
                </p>
              )}
              <Button variant="outline" className="self-start" onClick={catalog.reload}>
                {t('app.api.refresh')}
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
