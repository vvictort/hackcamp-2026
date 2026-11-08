import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarX2, LinkIcon } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { useDraftsT } from '@/components/drafts/useDraftsT'
import { ApiError, getTodayView, type TodayViewResponse } from '@/lib/altamira/drafts-api'

type State = { kind: 'loading' } | { kind: 'ok'; data: TodayViewResponse } | { kind: 'invalid' | 'expired' | 'error' }

/** Public substitute page: the link token is the credential, no sign-in. */
export default function TodayPage() {
  const t = useDraftsT()
  const { token = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    getTodayView(token)
      .then((data) => live && setState({ kind: 'ok', data }))
      .catch((e) => live && setState({ kind: e instanceof ApiError && e.status === 404 ? 'invalid' : e instanceof ApiError && e.status === 410 ? 'expired' : 'error' }))
    return () => {
      live = false
    }
  }, [token])

  if (state.kind === 'loading')
    return (
      <p role="status" className="text-body text-muted-foreground">
        {t('drafts.public.loading')}
      </p>
    )
  if (state.kind !== 'ok')
    return (
      <EmptyState
        icon={state.kind === 'error' ? <CalendarX2 aria-hidden /> : <LinkIcon aria-hidden />}
        title={t(`drafts.public.${state.kind}` as 'drafts.public.invalid')}
        description={t(state.kind === 'error' ? 'drafts.public.errorHint' : state.kind === 'expired' ? 'drafts.public.expiredHint' : 'drafts.public.invalidHint')}
      />
    )

  const d = state.data
  const none = <p className="text-body text-muted-foreground">{t('drafts.public.none')}</p>
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title={d.firstName ? t('drafts.public.title', { name: d.firstName }) : t('drafts.public.titleAnon')}
        description={`${t('drafts.public.description')} ${t('drafts.public.expires', { time: new Date(d.expiresAt).toLocaleString() })}`}
      />
      <Card title={t('drafts.public.supports')}>
        {d.supports.length === 0 ? none : (
          <ul className="list-disc pl-5 text-body">
            {d.supports.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('drafts.public.adaptations')}>
        {d.approvedAdaptations.length === 0 ? none : (
          <ul className="flex flex-col gap-3">
            {d.approvedAdaptations.map((a, i) => (
              <li key={i}>
                <p className="text-body font-medium">{a.title}</p>
                <p className="text-body">{a.text}</p>
                {a.lessonTitle && <p className="text-small text-muted-foreground">{t('drafts.public.lesson', { title: a.lessonTitle })}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('drafts.public.whatWorks')}>
        {d.whatWorks.length === 0 ? none : (
          <ul className="text-body">
            {d.whatWorks.map((w) => (
              <li key={w.adaptationType}>
                {w.adaptationType.replace(/_/g, ' ')}: {t('drafts.public.uses', { n: w.n })}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('drafts.public.schedule')}>
        {d.schedule.length === 0 ? none : (
          <ul className="text-body">
            {d.schedule.map((s, i) => (
              <li key={i}>
                {s.startsAt}-{s.endsAt} {s.className}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
