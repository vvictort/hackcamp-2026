/**
 * Altamira teacher dashboard. EXAMPLE data only (fictional students, see
 * src/components/altamira/exampleData.ts). Nothing here saves or sends.
 *
 * Look: ink-first bento. White cards and near-black cards on a grey canvas,
 * big tight headings, pill buttons, one signal accent. Status always shows an
 * icon and a word. No window/document/Date during render.
 */

import type { ReactNode } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { ArrowUpRight, Bell, ChevronRight, Search, type LucideIcon } from 'lucide-react'
import { StatusBadge, useToast } from '@/components/ui'
import { CLASSES, DRAFTS, SUGGESTIONS, studentById } from '@/components/altamira/exampleData'
import { cn } from '@/lib/utils'

/** Next few dates that need the teacher (example). Nov 1, 2026 is a Sunday. */
const COMING_UP = [
  { day: 'Wed', date: 'Nov 18', label: 'IEP review for Kai' },
  { day: 'Fri', date: 'Nov 20', label: 'Progress reports due' },
  { day: 'Tue', date: 'Nov 24', label: 'Team meeting' },
]

function Card({ children, dark, className, title }: { children: ReactNode; dark?: boolean; className?: string; title: string }) {
  const id = `card-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex min-w-0 flex-col gap-6 rounded-lg p-6 sm:p-8',
        dark ? 'bg-ink text-ink-foreground shadow-ink' : 'bg-card shadow-raised',
        className,
      )}
    >
      <h2 id={id} className="text-h1 font-extrabold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function RoundButton({ label, Icon, onClick }: { label: string; Icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-card text-foreground shadow-raised transition-shadow hover:shadow-lift"
    >
      <Icon className="size-5" strokeWidth={1.9} aria-hidden />
    </button>
  )
}

/** Pill button with a round arrow tucked inside the right end. One tap target. */
function ArrowButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex min-h-12 w-fit cursor-pointer items-center gap-3 rounded-full bg-card py-1.5 pl-5 pr-1.5 text-label font-bold text-foreground transition-colors hover:bg-secondary"
    >
      {children}
      <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:rotate-45">
        <ArrowUpRight className="size-[1.125rem]" strokeWidth={2.2} />
      </span>
    </button>
  )
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div aria-hidden className={cn('h-2 overflow-hidden rounded-full bg-secondary', className)}>
      <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function HomePage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { info } = useToast()
  const firstName = user?.name?.split(' ')[0] ?? ''
  const example = (what: string) => () => info('Example only', `${what} isn't connected yet.`)

  const pulseDone = 18
  const pulseGoal = 24
  const pulsePct = Math.round((pulseDone / pulseGoal) * 100)

  return (
    <div className="flex flex-col gap-10 px-4 py-6 sm:px-6 lg:px-0 lg:py-0">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-display font-extrabold sm:text-hero">Good morning{firstName && `, ${firstName}`}.</h1>
          <p className="max-w-[60ch] text-body-lg text-muted-foreground">
            Two Pulse check-ins are due before lunch, and three suggestions are waiting for you.
          </p>
        </div>
        <div className="flex gap-3">
          <RoundButton label="Search" Icon={Search} onClick={example('Search')} />
          <RoundButton label="Notifications" Icon={Bell} onClick={example('Notifications')} />
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2 lg:gap-8 xl:grid-cols-12">
        <Card title="Today" className="md:col-span-2 xl:col-span-7 xl:row-span-2">
          <ol className="flex flex-col gap-2">
            {CLASSES.map((c) => {
              const current = c.status === 'next'
              return (
                <li
                  key={c.time}
                  className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 rounded-md px-4 py-4', current && 'bg-secondary')}
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

        <Card dark title="Lesson Lens" className="xl:col-span-5">
          <p className="-mt-3 text-body text-ink-muted">{SUGGESTIONS.length} suggestions to review</p>
          <ul className="flex flex-col divide-y divide-white/10">
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
          <p className="text-display font-extrabold tabular-nums">
            {pulseDone}
            <span className="text-muted-foreground">/{pulseGoal}</span>
          </p>
          <div className="flex flex-col gap-3">
            <p className="text-body text-muted-foreground">
              Check-ins logged. {pulseGoal - pulseDone} to go.
            </p>
            <div
              role="progressbar"
              aria-label="Pulse check-ins this week"
              aria-valuenow={pulsePct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 overflow-hidden rounded-full bg-secondary"
            >
              <div className="h-full rounded-full bg-signal" style={{ width: `${pulsePct}%` }} />
            </div>
          </div>
        </Card>

        <Card title="Progress drafts" className="md:col-span-2 xl:col-span-7">
          <ul className="flex flex-col divide-y divide-border">
            {DRAFTS.map((d) => {
              const student = studentById(d.studentId)
              return (
                <li key={d.studentId} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-bold">{student.name}</p>
                    <p className="text-small text-muted-foreground">{d.due}</p>
                  </div>
                  <div className="hidden w-40 flex-col gap-2 sm:flex">
                    <p className="text-small font-semibold tabular-nums">
                      {d.linked} of {d.sentences} linked
                    </p>
                    <Bar pct={Math.round((d.linked / d.sentences) * 100)} />
                  </div>
                  <p className="text-small font-semibold tabular-nums sm:hidden">
                    {d.linked}/{d.sentences}
                    <span className="sr-only"> sentences linked</span>
                  </p>
                  <RoundButton label={`Open ${student.firstName}'s draft`} Icon={ChevronRight} onClick={example('Draft review')} />
                </li>
              )
            })}
          </ul>
        </Card>

        <Card title="Coming up" className="md:col-span-2 xl:col-span-5">
          <ul className="flex flex-col gap-4">
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

      <p className="text-small text-muted-foreground">Example data. All students shown are fictional.</p>
    </div>
  )
}
