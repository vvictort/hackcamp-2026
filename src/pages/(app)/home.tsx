/**
 * Altamyra teacher dashboard. Reads the signed-in teacher's classroom from the
 * database (src/lib/classroom.ts). A new teacher can load the fictional example
 * classroom into their own rows. Nothing here sends anything.
 *
 * Look: ink-first bento. White cards and near-black cards on a grey canvas,
 * big tight headings, pill buttons, one signal accent. Status always shows an
 * icon and a word. No window/document/Date during render.
 */

import type { ReactNode } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { ArrowUpRight, Bell, ChevronRight, Search } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, Progress, Spinner, StatusBadge, useToast } from '@/components/ui'
import { useClassroom } from '@/lib/classroom'
import { OnboardingRedirect } from '@/components/auth/onboarding'
import { cn } from '@/lib/utils'
import { useLang } from '@/i18n'
import { T } from '@/i18n/rich'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

/** Pill button with a round arrow tucked inside the right end. One tap target. */
function ArrowButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="raised" onClick={onClick} className="group h-12 w-fit gap-3 pl-5 pr-1.5 font-bold">
      {children}
      <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <ArrowUpRight className="size-4.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.2} />
      </span>
    </Button>
  )
}

export default function HomePage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { info } = useToast()
  const { t } = useLang()
  const firstName = user?.name?.split(' ')[0] ?? ''
  const example = (what: string) => () => info(t('app.nav.exampleOnly'), t('app.home.notConnected', { what }))

  const room = useClassroom()
  const { classes, suggestions, drafts, events, pulse, studentById } = room
  const pulsePct = pulse.goal ? Math.min(100, Math.round((pulse.done / pulse.goal) * 100)) : 0
  const pulseDue = classes.filter((c) => c.status === 'pulse').length
  const summaryKey = `app.home.summary${pulseDue === 1 ? 'One' : 'Many'}${suggestions.length === 1 ? 'One' : 'Many'}` as const
  const loadExample = () =>
    room.seed().catch(() => info(t('app.home.seedFailedTitle'), t('app.home.seedFailedBody')))

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <OnboardingRedirect />
      <PageHeader
        titleClassName="sm:text-hero"
        title={
          firstName ? <T k="app.home.greeting" vars={{ name: firstName }} /> : t('app.home.greetingNoName')
        }
        description={
          room.loading || room.empty
            ? t('app.home.intro')
            : t(summaryKey, { pulse: pulseDue, suggestions: suggestions.length })
        }
        actions={
          <>
            <Button variant="raised" size="icon" aria-label={t('app.home.search')} onClick={example(t('app.home.search'))}>
              <Search strokeWidth={1.9} aria-hidden />
            </Button>
            <LanguageSwitcher />
            <Button variant="raised" size="icon" aria-label={t('app.home.notifications')} onClick={example(t('app.home.notifications'))}>
              <Bell strokeWidth={1.9} aria-hidden />
            </Button>
          </>
        }
      />

      {room.loading ? (
        <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
          <Spinner /> {t('app.home.loading')}
        </p>
      ) : room.failed ? (
        <Card role="alert" title={t('app.home.failedTitle')}>
          <p className="text-body text-muted-foreground">{t('app.home.failedBody')}</p>
        </Card>
      ) : room.empty ? (
        <Card>
          <EmptyState
            title={t('app.home.emptyTitle')}
            description={t('app.home.emptyBody')}
            action={{ label: room.seeding ? t('app.home.loadingShort') : t('app.home.loadExample'), onClick: room.canSeed ? loadExample : () => {} }}
          />
        </Card>
      ) : (
        <div className="stagger-rise grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-12">
          <Card title={t('app.home.today')} className="md:col-span-2 xl:col-span-7 xl:row-span-2">
            <ol className="flex flex-1 flex-col justify-between gap-2">
              {classes.map((c) => {
                const current = c.status === 'next'
                return (
                  <li
                    key={c.time}
                    className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 rounded-md px-3 py-3', current && 'bg-secondary')}
                  >
                    <span className={cn('text-label tabular-nums', current ? 'font-bold' : 'text-muted-foreground')}>{c.time}</span>
                    <div className="flex flex-col gap-1">
                      <p className="text-body font-bold">
                        {current && <span className="sr-only">{t('app.home.upNext')}</span>}
                        {c.subject}
                      </p>
                      <p className="text-small text-muted-foreground">{c.lesson}</p>
                      {c.status === 'pulse' && (
                        <StatusBadge tone="warning" className="mt-2 self-start">
                          {t('app.home.pulseDue')}
                        </StatusBadge>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>

          <Card tone="ink" title={t('app.home.lessonLens')} className="xl:col-span-5">
            <p className="-mt-2 text-body text-ink-muted">{suggestions.length === 1 ? t('app.home.suggestionsOne') : t('app.home.suggestionsMany', { n: suggestions.length })}</p>
            <ul className="flex flex-col divide-y divide-ink-foreground/10">
              {suggestions.map((s) => {
                const modification = s.kind === 'modification'
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0 truncate text-body font-bold">{studentById(s.studentId).name}</span>
                    <StatusBadge tone={modification ? 'warning' : 'success'}>{modification ? t('app.home.modification') : t('app.home.adaptation')}</StatusBadge>
                  </li>
                )
              })}
            </ul>
            <ArrowButton onClick={example(t('app.home.reviewingSuggestions'))}>{t('app.home.reviewNow')}</ArrowButton>
          </Card>

          <Card title={t('app.home.pulseWeek')} className="xl:col-span-5">
            <p className="text-h1 font-extrabold tabular-nums">
              {pulse.done}
              <span className="text-muted-foreground">/{pulse.goal}</span>
            </p>
            <div className="flex flex-col gap-3">
              <p className="text-body text-muted-foreground">
                {t('app.home.checkinsToGo', { n: Math.max(0, pulse.goal - pulse.done) })}
              </p>
              <Progress value={pulsePct} tone="signal" label={t('app.home.pulseProgress')} />
            </div>
          </Card>

          <Card title={t('app.home.progressDrafts')} className="md:col-span-2 xl:col-span-7">
            <ul className="-my-3 flex flex-col">
              {drafts.map((d) => {
                const student = studentById(d.studentId)
                return (
                  // The chevron's ::after stretches over the row, so the whole row opens the draft and earns the hover.
                  // The divider is an inset ::before so it keeps the card's text edges while the tint bleeds 12px wider.
                  <li
                    key={d.studentId}
                    className="relative -mx-3 flex items-center gap-4 rounded-md px-3 py-3 transition-colors before:absolute before:inset-x-3 before:bottom-0 before:border-b before:border-border last:before:hidden hover:bg-muted has-focus-visible:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-bold">{student.name}</p>
                      <p className="text-small text-muted-foreground">{d.due}</p>
                    </div>
                    <div className="hidden w-40 flex-col gap-2 sm:flex">
                      <p className="text-small font-semibold tabular-nums">
                        {t('app.home.linked', { linked: d.linked, total: d.sentences })}
                      </p>
                      <Progress value={Math.round((d.linked / d.sentences) * 100)} />
                    </div>
                    <p className="text-small font-semibold tabular-nums sm:hidden">
                      {d.linked}/{d.sentences}
                      <span className="sr-only"> {t('app.home.sentencesLinked')}</span>
                    </p>
                    <Button
                      variant="raised"
                      size="icon"
                      aria-label={t('app.home.openDraft', { name: student.firstName })}
                      onClick={example(t('app.home.draftReview'))}
                      className="after:absolute after:inset-0 after:rounded-md"
                    >
                      <ChevronRight strokeWidth={1.9} aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title={t('app.home.comingUp')} className="md:col-span-2 xl:col-span-5">
            <ul className="flex flex-col gap-3">
              {events.map((e) => (
                <li key={e.date} className="flex items-center gap-4">
                  <span className="flex w-16 shrink-0 flex-col items-center rounded-md bg-secondary py-2 leading-tight">
                    <span className="text-small font-semibold text-muted-foreground">{e.day}</span>
                    <span className="text-label font-bold tabular-nums">{e.date}</span>
                  </span>
                  <span className="text-body font-bold">{e.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  )
}
