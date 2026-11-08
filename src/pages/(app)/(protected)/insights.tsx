import { RoleGate } from '@/lib/altamira/RoleGate'
import { useMemo } from 'react'
import { useAsyncResource, getAuthToken } from 'deepspace'
import { CircleX, EyeOff, Lock, Sparkles } from 'lucide-react'
import { useLang } from '@/i18n'
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui'
import { useAltamiraMe } from '@/lib/altamira/role'

type Group = { dims: Record<string, string | null>; students: number | null; count: number | null; suppressed: boolean }
type InsightsData = { groups: Group[]; minGroupSize: number; monthlyNarrative?: string | { text?: string; period?: string | null } | null }

class InsightsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function fetchFrom(url: string, signal: AbortSignal): Promise<InsightsData> {
  const token = await getAuthToken().catch(() => null)
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal })
  const json = (await res.json().catch(() => null)) as (InsightsData & { error?: { message?: string } }) | null
  if (!res.ok || !json) throw new InsightsError(res.status, json?.error?.message ?? `HTTP ${res.status}`)
  return { ...json, groups: json.groups ?? [], minGroupSize: json.minGroupSize ?? 10 }
}

/** The signed-in district lead's own district summary; the month defaults to the latest one with data. */
function fetchInsights(districtId: string | null, signal: AbortSignal): Promise<InsightsData> {
  if (!districtId) return Promise.reject(new InsightsError(403, 'forbidden'))
  return fetchFrom(`/api/v1/districts/${encodeURIComponent(districtId)}/insights?groupBy=schoolId,goalArea`, signal)
}

const narrativeOf = (d: InsightsData | null) => {
  const n = d?.monthlyNarrative
  return (typeof n === 'string' ? n : n?.text)?.trim() || ''
}

/** '2026-11' -> 'November 2026'; any other period text is shown as it is. */
function monthLabel(d: InsightsData | null): string | null {
  const n = d?.monthlyNarrative
  const period = typeof n === 'object' && n ? n.period : null
  if (!period) return null
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (!m) return period
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function InsightsPageBody() {
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
  const { me } = useAltamiraMe()
  const districtId = me?.memberships.find((m) => m.role === 'district_lead')?.districtId ?? null
  const data = useAsyncResource<InsightsData>((signal) => fetchInsights(districtId, signal), [districtId], { retry: 0 })

  const bySchool = useMemo(() => {
    const map = new Map<string, Group[]>()
    for (const g of data.data?.groups ?? []) {
      const key = g.dims.schoolId ?? ''
      map.set(key, [...(map.get(key) ?? []), g])
    }
    return [...map.entries()]
  }, [data.data])

  const allHidden = (data.data?.groups ?? []).every((g) => g.suppressed)
  const forbidden = data.status === 'error' && /HTTP 403|forbidden/i.test(data.error ?? '')

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('insights.title')} description={t('insights.description')} />
      {data.status === 'ready' && (
        <Card title={monthLabel(data.data) ? t('insights.narrativeTitle', { month: monthLabel(data.data) ?? '' }) : t('insights.narrativeTitleNoMonth')}>
          <p className="whitespace-pre-line text-body">{narrativeOf(data.data) || t('insights.narrativeNone')}</p>
          <p className="flex items-center gap-2 text-small text-muted-foreground">
            <Sparkles className="size-4 shrink-0" aria-hidden />
            {t('insights.aiNote')}
          </p>
        </Card>
      )}
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
      ) : bySchool.length === 0 || allHidden ? (
        <Card>
          <EmptyState className="py-10" title={t('insights.emptyTitle')} description={t('insights.emptyBody')} />
        </Card>
      ) : (
        <div className="stagger-rise flex flex-col gap-6">
          {bySchool.map(([schoolId, groups]) => (
            <Card key={schoolId} title={schoolId ? t('insights.school', { id: schoolId.slice(0, 8) }) : t('insights.noSchool')}>
              <table className="w-full text-left text-body">
                <thead>
                  <tr className="border-b border-border text-label text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-semibold">{t('insights.colArea')}</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">{t('insights.colStudents')}</th>
                    <th scope="col" className="py-2 font-semibold">{t('insights.colEvents')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groups.map((g, i) => (
                    <tr key={i}>
                      <th scope="row" className="py-3 pr-3 font-semibold">{g.dims.goalArea ?? t('insights.noArea')}</th>
                      {g.suppressed ? (
                        <td colSpan={2} className="py-3 text-small text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <EyeOff className="size-4 shrink-0" aria-hidden />
                            {t('insights.suppressed', { n: data.data?.minGroupSize ?? 10 })}
                          </span>
                        </td>
                      ) : (
                        <>
                          <td className="py-3 pr-3 tabular-nums">{g.students ?? 0}</td>
                          <td className="py-3 tabular-nums">{g.count ?? 0}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default function InsightsPage() {
  return (
    <RoleGate path="/insights">
      <InsightsPageBody />
    </RoleGate>
  )
}
