import { useMemo } from 'react'
import { useAsyncResource, getAuthToken } from 'deepspace'
import { CircleX, EyeOff, Lock, Users } from 'lucide-react'
import { useLang } from '@/i18n'
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { useAltamiraMe } from '@/lib/altamira/role'

type Group = { dims: Record<string, string | null>; students: number | null; count: number | null; suppressed: boolean }
type InsightsData = { groups: Group[]; minGroupSize: number }

class InsightsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function fetchInsights(signal: AbortSignal): Promise<InsightsData> {
  const token = await getAuthToken().catch(() => null)
  const res = await fetch('/api/v1/insights?groupBy=schoolId,goalArea', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  })
  const json = (await res.json().catch(() => null)) as (InsightsData & { error?: { message?: string } }) | null
  if (!res.ok || !json) throw new InsightsError(res.status, json?.error?.message ?? `HTTP ${res.status}`)
  return json
}

export default function InsightsPage() {
  const { t } = useLang()
  const { role, loading } = useAltamiraMe()
  if (loading) {
    return (
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageHeader title={t('insights.title')} description={t('insights.description')} />
        <Card role="status" className="flex-row items-center justify-center gap-3 text-small text-muted-foreground">
          <Spinner />
          {t('insights.loading')}
        </Card>
      </div>
    )
  }
  if (role !== 'district_lead') {
    return (
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageHeader title={t('insights.title')} description={t('insights.description')} />
        <Card role="status">
          <EmptyState className="py-10" icon={<Lock className="size-8" aria-hidden />} title={t('insights.notForRole')} description={t('insights.notForRoleBody')} />
        </Card>
      </div>
    )
  }
  return <InsightsView />
}

function InsightsView() {
  const { t } = useLang()
  const data = useAsyncResource<InsightsData>(fetchInsights, [], { retry: 0 })

  const bySchool = useMemo(() => {
    const map = new Map<string, Group[]>()
    for (const g of data.data?.groups ?? []) {
      const key = g.dims.schoolId ?? ''
      map.set(key, [...(map.get(key) ?? []), g])
    }
    return [...map.entries()]
  }, [data.data])

  const forbidden = data.status === 'error' && /HTTP 403|forbidden/i.test(data.error ?? '')

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('insights.title')} description={t('insights.description')} />
      <p className="flex items-center gap-2 text-small text-muted-foreground">
        <EyeOff className="size-4 shrink-0" aria-hidden />
        {t('insights.minNote', { n: data.data?.minGroupSize ?? 10 })}
      </p>
      {data.status === 'loading' ? (
        <Card role="status" className="flex-row items-center justify-center gap-3 text-small text-muted-foreground">
          <Spinner />
          {t('insights.loading')}
        </Card>
      ) : data.status === 'error' ? (
        <div role="alert" className="flex gap-3 rounded-lg border-2 border-destructive bg-card p-6">
          <CircleX className="size-6 shrink-0" aria-hidden />
          <div className="flex flex-col gap-2">
            <p className="text-label font-semibold">{forbidden ? t('insights.forbidden') : t('insights.failed')}</p>
            {!forbidden && (
              <Button variant="outline" className="mt-3 self-start" onClick={data.reload}>
                {t('insights.retry')}
              </Button>
            )}
          </div>
        </div>
      ) : bySchool.length === 0 ? (
        <Card>
          <EmptyState className="py-10" title={t('insights.emptyTitle')} description={t('insights.emptyBody')} />
        </Card>
      ) : (
        <div className="stagger-rise flex flex-col gap-6">
          {bySchool.map(([schoolId, groups]) => (
            <Card key={schoolId} title={schoolId ? t('insights.school', { id: schoolId.slice(0, 8) }) : t('insights.noSchool')}>
              <ul className="flex flex-col divide-y divide-border">
                {groups.map((g, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="text-label font-semibold">{g.dims.goalArea ?? t('insights.noArea')}</span>
                    {g.suppressed ? (
                      <span className="flex items-center gap-2 text-small text-muted-foreground" title={t('insights.suppressedHelp', { n: data.data?.minGroupSize ?? 10 })}>
                        <EyeOff className="size-4" aria-hidden />
                        {t('insights.suppressed', { n: data.data?.minGroupSize ?? 10 })}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-small text-muted-foreground">
                        <Users className="size-4" aria-hidden />
                        {t('insights.students', { n: g.students ?? 0 })} · {t('insights.events', { n: g.count ?? 0 })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
