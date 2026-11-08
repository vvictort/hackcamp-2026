/**
 * Altamyra teacher dashboard. EXAMPLE data only (fictional students, see
 * src/components/altamira/exampleData.ts). Nothing here saves or sends.
 *
 * Look: ink-first bento. White cards and near-black cards on a grey canvas,
 * big tight headings, pill buttons, one signal accent. Status always shows an
 * icon and a word. No window/document/Date during render.
 */

import type { ReactNode } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { ArrowUpRight, Bell, ChevronRight, Search } from 'lucide-react'
import { Button, Card, PageHeader, Progress, StatusBadge, useToast } from '@/components/ui'
import { CLASSES, COMING_UP, DRAFTS, PULSE, SUGGESTIONS, studentById } from '@/components/altamira/exampleData'
import { cn } from '@/lib/utils'

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
  const firstName = user?.name?.split(' ')[0] ?? ''
  const example = (what: string) => () => info('Example only', `${what} isn't connected yet.`)

  const pulsePct = Math.round((PULSE.done / PULSE.goal) * 100)

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        titleClassName="sm:text-hero"
        title={
          <>
            Good morning
            {firstName && (
              <>
                , <span className="text-highlight">{firstName}</span>
              </>
            )}
            .
          </>
        }
        description="Two Pulse check-ins are due before lunch, and three suggestions are waiting for you."
        actions={
          <>
            <Button variant="raised" size="icon" aria-label="Search" onClick={example('Search')}>
              <Search strokeWidth={1.9} aria-hidden />
            </Button>
            <Button variant="raised" size="icon" aria-label="Notifications" onClick={example('Notifications')}>
              <Bell strokeWidth={1.9} aria-hidden />
            </Button>
          </>
        }
      />

      <div className="stagger-rise grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-12">
        <Card title="Today" className="md:col-span-2 xl:col-span-7 xl:row-span-2">
          <ol className="flex flex-1 flex-col justify-between gap-2">
            {CLASSES.map((c) => {
              const current = c.status === 'next'
              return (
                <li
                  key={c.time}
                  className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 rounded-md px-3 py-3', current && 'bg-secondary')}
                >
                  <span className={cn('text-label tabular-nums', current ? 'font-bold' : 'text-muted-foreground')}>{c.time}</span>
                  <div className="flex flex-col gap-1">
                    <p className="text-body font-bold">
                      {current && <span className="sr-only">Up next: </span>}
                      {c.subject}
                    </p>
                    <p className="text-small text-muted-foreground">{c.lesson}</p>
                    {c.status === 'pulse' && (
                      <StatusBadge tone="warning" className="mt-2 self-start">
                        Pulse due
                      </StatusBadge>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </Card>

        <Card tone="ink" title="Lesson Lens" className="xl:col-span-5">
          <p className="-mt-2 text-body text-ink-muted">{SUGGESTIONS.length} suggestions to review</p>
          <ul className="flex flex-col divide-y divide-ink-foreground/10">
            {SUGGESTIONS.map((s) => {
              const modification = s.kind === 'modification'
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate text-body font-bold">{studentById(s.studentId).name}</span>
                  <StatusBadge tone={modification ? 'warning' : 'success'}>{modification ? 'Modification' : 'Adaptation'}</StatusBadge>
                </li>
              )
            })}
          </ul>
          <ArrowButton onClick={example('Reviewing suggestions')}>Review now</ArrowButton>
        </Card>

        <Card title="Pulse this week" className="xl:col-span-5">
          <p className="text-h1 font-extrabold tabular-nums">
            {PULSE.done}
            <span className="text-muted-foreground">/{PULSE.goal}</span>
          </p>
          <div className="flex flex-col gap-3">
            <p className="text-body text-muted-foreground">
              Check-ins logged. {PULSE.goal - PULSE.done} to go.
            </p>
            <Progress value={pulsePct} tone="signal" label="Pulse check-ins this week" />
          </div>
        </Card>

        <Card title="Progress drafts" className="md:col-span-2 xl:col-span-7">
          <ul className="-my-3 flex flex-col">
            {DRAFTS.map((d) => {
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
                      {d.linked} of {d.sentences} linked
                    </p>
                    <Progress value={Math.round((d.linked / d.sentences) * 100)} />
                  </div>
                  <p className="text-small font-semibold tabular-nums sm:hidden">
                    {d.linked}/{d.sentences}
                    <span className="sr-only"> sentences linked</span>
                  </p>
                  <Button
                    variant="raised"
                    size="icon"
                    aria-label={`Open ${student.firstName}'s draft`}
                    onClick={example('Draft review')}
                    className="after:absolute after:inset-0 after:rounded-md"
                  >
                    <ChevronRight strokeWidth={1.9} aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card title="Coming up" className="md:col-span-2 xl:col-span-5">
          <ul className="flex flex-col gap-3">
            {COMING_UP.map((e) => (
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
    </div>
  )
}
