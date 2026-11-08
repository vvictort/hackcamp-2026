/**
 * Altamyra teacher dashboard. Reads the signed-in teacher's classroom from the
 * database (src/lib/classroom.ts). A new teacher can load the fictional example
 * classroom into their own rows. Lesson Lens (src/lib/lessonLens.ts) is the one
 * thing that sends: the worker strips names before the agent sees anything.
 *
 * Look: ink-first bento. White cards and near-black cards on a grey canvas,
 * big tight headings, pill buttons, one signal accent. Status always shows an
 * icon and a word. No window/document/Date during render.
 */

import { useState, type ReactNode } from 'react'
import { useAuthProfileReady } from 'deepspace'
import { ArrowUpRight, Bell, ChevronRight, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { Button, Card, ConfirmModal, EmptyState, FormField, Modal, PageHeader, Progress, Spinner, StatusBadge, Textarea, useToast } from '@/components/ui'
import { useClassroom } from '@/lib/classroom'
import { useLessonLens, type Decision, type PendingSuggestion } from '@/lib/lessonLens'
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

/** One suggestion: who, which kind, the action and why, then Approve or Reject. */
function SuggestionItem({ s, name, busy, onDecide, ink }: { s: PendingSuggestion; name: string; busy: boolean; onDecide: (d: Decision) => void; ink?: boolean }) {
  const { t } = useLang()
  const modification = s.kind === 'modification'
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-body font-bold">{name}</span>
        <StatusBadge tone={modification ? 'warning' : 'success'}>{modification ? t('app.home.modification') : t('app.home.adaptation')}</StatusBadge>
      </div>
      <p className="text-body">{s.text}</p>
      <p className={cn('text-small', ink ? 'text-ink-muted' : 'text-muted-foreground')}>{t('app.home.why', { why: s.why })}</p>
      <div className="mt-1 flex gap-2">
        <Button variant="raised" size="sm" loading={busy} onClick={() => onDecide('approved')} aria-label={t('app.home.approveFor', { name })}>
          {t('app.home.approve')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDecide('rejected')} aria-label={t('app.home.rejectFor', { name })}>
          {t('app.home.reject')}
        </Button>
      </div>
    </li>
  )
}

const CARD_LIMIT = 2

export default function HomePage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { info } = useToast()
  const { t } = useLang()
  const firstName = user?.name?.split(' ')[0] ?? ''
  const example = (what: string) => () => info(t('app.nav.exampleOnly'), t('app.home.notConnected', { what }))

  const room = useClassroom()
  const { classes, drafts, events, pulse, studentById } = room
  const lens = useLessonLens()
  const suggestions = lens.pending
  const [ask, setAsk] = useState<{ id: string; lesson: string } | null>(null)
  const [details, setDetails] = useState('')
  const [confirmMod, setConfirmMod] = useState<PendingSuggestion | null>(null)
  const [reviewAll, setReviewAll] = useState(false)
  const decide = (s: PendingSuggestion) => (d: Decision) =>
    d === 'approved' && s.kind === 'modification' ? setConfirmMod(s) : void lens.decide(s.id, d)
  const sendAsk = () => {
    if (!ask) return
    void lens.suggest(ask.id, details.trim() || undefined)
    setAsk(null)
    setDetails('')
  }
  const item = (s: PendingSuggestion, ink?: boolean) => (
    <SuggestionItem key={s.id} s={s} ink={ink} name={studentById(s.studentId).name} busy={lens.deciding === s.id} onDecide={decide(s)} />
  )
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
              {classes.map((c, i) => {
                const current = c.status === 'next'
                const blockId = c.studentIds.length ? lens.classBlockId(i, c) : undefined
                return (
                  <li
                    key={c.time}
                    className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 rounded-md px-3 py-3', current && 'bg-secondary')}
                  >
                    <span className={cn('text-label tabular-nums', current ? 'font-bold' : 'text-muted-foreground')}>{c.time}</span>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
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
                      {blockId && (
                        <Button
                          variant="raised"
                          size="sm"
                          className="self-start"
                          loading={lens.suggesting === blockId}
                          disabled={!!lens.suggesting}
                          aria-label={t('app.home.getSuggestionsFor', { lesson: c.lesson })}
                          onClick={() => setAsk({ id: blockId, lesson: c.lesson })}
                        >
                          {lens.suggesting !== blockId && <Sparkles strokeWidth={1.9} aria-hidden className="size-4" />}
                          {t('app.home.getSuggestions')}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>

          <Card tone="ink" title={t('app.home.lessonLens')} className="xl:col-span-5">
            <p className="-mt-2 text-body text-ink-muted">{suggestions.length === 1 ? t('app.home.suggestionsOne') : t('app.home.suggestionsMany', { n: suggestions.length })}</p>
            {suggestions.length ? (
              <ul className="flex flex-col divide-y divide-ink-foreground/10">{suggestions.slice(0, CARD_LIMIT).map((s) => item(s, true))}</ul>
            ) : (
              <p className="text-body text-ink-muted">{t('app.home.lensEmpty')}</p>
            )}
            {suggestions.length > CARD_LIMIT && (
              <ArrowButton onClick={() => setReviewAll(true)}>{t('app.home.lensMore', { n: suggestions.length - CARD_LIMIT })}</ArrowButton>
            )}
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

      <Modal open={!!ask} onClose={() => setAsk(null)} size="md">
        <Modal.Header>
          <Modal.Title>{t('app.home.lensDetailsTitle', { lesson: ask?.lesson ?? '' })}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="flex flex-col gap-4">
          <FormField label={t('app.home.lensDetailsLabel')} hint={t('app.home.lensDetailsHint')}>
            <Textarea value={details} maxLength={4000} rows={5} onChange={(e) => setDetails(e.target.value)} />
          </FormField>
          <p className="flex gap-2 text-small text-muted-foreground">
            <ShieldCheck aria-hidden strokeWidth={1.9} className="size-5 shrink-0" />
            {t('app.home.lensPrivacy')}
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setAsk(null)}>{t('app.home.cancel')}</Button>
          <Button onClick={sendAsk}>
            <Sparkles strokeWidth={1.9} aria-hidden className="size-4" />
            {t('app.home.getSuggestions')}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal open={reviewAll && suggestions.length > 0} onClose={() => setReviewAll(false)} size="lg">
        <Modal.Header>
          <Modal.Title>{t('app.home.lensAllTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ul className="flex flex-col divide-y divide-border">{suggestions.map((s) => item(s))}</ul>
        </Modal.Body>
      </Modal>

      <ConfirmModal
        open={!!confirmMod}
        onClose={() => setConfirmMod(null)}
        onConfirm={() => {
          if (confirmMod) void lens.decide(confirmMod.id, 'approved')
          setConfirmMod(null)
        }}
        title={t('app.home.confirmModTitle')}
        description={t('app.home.confirmModBody')}
        confirmText={t('app.home.confirmModAction')}
        cancelText={t('app.home.cancel')}
        variant="default"
      />
    </div>
  )
}
