import { useAsyncResource, integration } from 'deepspace'
import { CircleX, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'

interface IntegrationCatalog {
  integrations?: Record<string, unknown> | unknown[]
}

export default function ApiStatusPage() {
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
    <div className="flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-0 lg:py-0">
      <header className="flex flex-col gap-2">
        <h1 className="text-display font-extrabold">API status</h1>
        <p className="max-w-[60ch] text-body-lg text-muted-foreground">
          Check whether the app can reach its connected services.
        </p>
      </header>

      {catalog.error && catalog.data && (
        <div role="status" className="flex gap-3 rounded-lg border-2 border-warning bg-card p-6">
          <TriangleAlert className="size-6 shrink-0" aria-hidden />
          <div className="flex flex-col gap-2">
            <p className="text-label font-semibold">Showing the last loaded catalog</p>
            <p className="text-small text-muted-foreground">{catalog.error}</p>
          </div>
        </div>
      )}

      {catalog.status === 'loading' ? (
        <div
          role="status"
          className="flex items-center justify-center gap-3 rounded-lg bg-card p-6 text-small text-muted-foreground shadow-raised"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          Loading integration catalog...
        </div>
      ) : catalog.status === 'error' ? (
        <div role="alert" className="flex gap-3 rounded-lg border-2 border-destructive bg-card p-6">
          <CircleX className="size-6 shrink-0" aria-hidden />
          <div className="flex flex-col gap-2">
            <p className="text-label font-semibold">Could not load API data</p>
            <p className="text-small text-muted-foreground">{catalog.error}</p>
            {catalog.retryCount > 0 && (
              <p className="text-small text-muted-foreground">
                Retried {catalog.retryCount} time{catalog.retryCount === 1 ? '' : 's'} automatically.
              </p>
            )}
            <Button variant="outline" className="mt-3 self-start" onClick={catalog.reload}>
              Retry
            </Button>
          </div>
        </div>
      ) : integrationCount === 0 ? (
        <section className="flex flex-col items-center gap-2 rounded-lg bg-card p-6 py-16 text-center shadow-raised">
          <h2 className="text-h2 font-bold">No integrations available</h2>
          <p className="max-w-sm text-small text-muted-foreground">
            The catalog loaded, but it did not return any integration definitions.
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-5 rounded-lg bg-card p-6 shadow-raised">
          <div className="flex flex-col gap-2">
            <h2 className="text-h2 font-bold">Integration catalog ready</h2>
            <p className="text-small text-muted-foreground">
              {integrationCount} integration{integrationCount === 1 ? '' : 's'} available.
            </p>
            {catalog.isRefreshing && (
              <p role="status" className="text-small text-muted-foreground">
                Refreshing...
              </p>
            )}
          </div>
          <Button variant="outline" className="self-start" onClick={catalog.reload}>
            Refresh
          </Button>
        </section>
      )}
    </div>
  )
}
