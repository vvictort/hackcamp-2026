/**
 * Altamyra home, built around the school day. Teacher: today's lesson plans to
 * approve and students missing a plan. EA: today's approved plans and the end
 * of day review. Both: summaries waiting for approval. Case manager: weekly
 * summary and students. Parents, district leads and school administrators are
 * sent to their own page. The dev panel (load demo data, act as a role) shows
 * only when the backend has ALTAMYRA_DEV_SEED=true.
 */

import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuthProfileReady } from 'deepspace'
import { ArrowUpRight, CircleCheck, CircleX, FileText, FlaskConical, MoonStar, UsersRound } from 'lucide-react'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatusBadge,
  buttonVariants,
  useToast,
} from '@/components/ui'
import { OnboardingRedirect } from '@/components/auth/onboarding'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useLang } from '@/i18n'
import { T } from '@/i18n/rich'
import type { MessageKey } from '@/i18n/en'
import { apiPost } from '@/lib/altamyra/api'
import { runDemoDay, type DemoDayResult } from '@/lib/altamyra/demo-day-api'
import { START_PATH } from '@/lib/altamyra/RoleGate'
import { ALTAMYRA_ROLES, useAltamyraMe, type AltamyraRole } from '@/lib/altamyra/role'
import { getToday, reviewProgress, splitToday, summaryLink, type PendingSummary, type Today } from '@/lib/altamyra/home-api'
import { useLoad } from '@/lib/useLoad'

const ROLE_LABEL: Record<AltamyraRole, MessageKey> = {
  ea: 'app.role.ea',
  teacher: 'app.role.teacher',
  case_manager: 'app.role.case_manager',
  parent: 'app.role.parent',
  district_lead: 'app.role.district_lead',
  school_admin: 'app.role.school_admin',
}

const planLink = (id: string) => `/students/${encodeURIComponent(id)}?tab=plan`
const linkClass = 'rounded-md font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2'

function PendingCard({ pending }: { pending: PendingSummary[] }) {
  const { t } = useLang()
  return (
    <Card title={t('app.home.pendingTitle')}>
      {pending.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('app.home.pendingNone')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <FileText className="size-4 shrink-0" aria-hidden />
              <Link to={summaryLink(s)} className={linkClass}>
                {t('app.home.pendingItem', { kind: t(`app.summaries.kind.${s.kind}`), student: s.label })}
              </Link>
              <span className="ml-auto text-small text-muted-foreground">{s.period}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TeacherHome({ today }: { today: Today }) {
  const { t } = useLang()
  const { withPlan, missing } = splitToday(today.plans)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t('app.home.plansTitle')}>
        {withPlan.length === 0 ? (
          <p className="text-body text-muted-foreground">{t('app.home.plansEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {withPlan.map((s) => (
              <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span className="text-body font-semibold">{s.label}</span>
                  <span className="text-small text-muted-foreground">{s.plan?.title}</span>
                </span>
                {s.plan?.status === 'approved' ? (
                  <StatusBadge tone="success">{t('app.home.planApproved')}</StatusBadge>
                ) : (
                  <span className="flex flex-wrap items-center gap-3">
                    <StatusBadge tone="warning">{t('app.home.planDraft')}</StatusBadge>
                    <Link to={planLink(s.studentId)} className={buttonVariants({ size: 'sm' })}>
                      {t('app.home.reviewApprove')}
                    </Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('app.home.missingTitle')}>
        {missing.length === 0 ? (
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <CircleCheck className="size-4" aria-hidden /> {t('app.home.missingNone')}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {missing.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between gap-3">
                <span className="text-body font-semibold">{s.label}</span>
                <Link to={planLink(s.studentId)} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                  {t('app.home.addPlan')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="lg:col-span-2">
        <PendingCard pending={today.pending} />
      </div>
    </div>
  )
}

function EaHome({ today }: { today: Today }) {
  const { t } = useLang()
  const { done, total } = reviewProgress(today.review)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={t('app.home.eodTitle')}>
        <p className="text-body text-muted-foreground">{t('app.home.eodBody')}</p>
        <p className="text-label font-semibold">{total === 0 ? t('app.home.eodNone') : t('app.home.eodProgress', { done, total })}</p>
        <Link to="/end-of-day" className={buttonVariants({ className: 'w-fit' })}>
          <MoonStar aria-hidden /> {t('app.home.eodStart')}
        </Link>
      </Card>
      <Card title={t('app.home.eaPlansTitle')}>
        {today.plans.students.length === 0 ? (
          <p className="text-body text-muted-foreground">{t('app.home.eaPlansEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {today.plans.students.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between gap-3">
                <span className="text-body font-semibold">{s.label}</span>
                {s.plan?.status === 'approved' ? (
                  <Link to={planLink(s.studentId)} className={linkClass}>
                    {s.plan.title}
                  </Link>
                ) : (
                  <span className="text-small text-muted-foreground">{t('app.home.eaWaiting')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="lg:col-span-2">
        <PendingCard pending={today.pending} />
      </div>
    </div>
  )
}

function CaseManagerHome() {
  const { t } = useLang()
  const cards = [
    { to: '/summaries', Icon: FileText, title: 'app.home.cmWeeklyTitle', body: 'app.home.cmWeeklyBody', cta: 'app.home.cmWeeklyOpen' },
    { to: '/students', Icon: UsersRound, title: 'app.home.cmTitle', body: 'app.home.cmStudentsBody', cta: 'app.home.cmStudentsOpen' },
  ] as const
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {cards.map((c) => (
        <Card key={c.to} title={t(c.title)}>
          <p className="text-body text-muted-foreground">{t(c.body)}</p>
          <Link to={c.to} className={buttonVariants({ className: 'w-fit' })}>
            <c.Icon aria-hidden /> {t(c.cta)} <ArrowUpRight aria-hidden />
          </Link>
        </Card>
      ))}
    </div>
  )
}

/** Result of "Run full demo day": one row per step with an icon and a word, so colour is never the only signal. */
function DemoDayResults({ result }: { result: DemoDayResult }) {
  const { t } = useLang()
  const okCount = result.steps.filter((s) => s.ok).length
  return (
    <div className="flex flex-col gap-2" data-testid="demo-day-results">
      <p role="status" className="text-label font-semibold">
        {t('app.demoDay.title')}: {t('app.demoDay.summary', { ok: okCount, total: result.steps.length })}
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {result.steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-body">
            <span className={`flex w-20 shrink-0 items-center gap-1 font-semibold ${s.ok ? '' : 'text-destructive-strong'}`}>
              {s.ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
              {s.ok ? t('app.demoDay.done') : t('app.demoDay.failed')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{s.role === 'system' ? t('app.demoDay.system') : t(ROLE_LABEL[s.role])}</span>
              {': '}
              {s.action}
              <span className="block text-muted-foreground">{s.detail}</span>
            </span>
            <Link to={s.page} className={linkClass}>
              {t('app.demoDay.open')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function HomePage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { error: toastError, success } = useToast()
  const { t } = useLang()
  const { role, devEnabled, me, loading, seed, switchRole, refresh } = useAltamyraMe()
  const firstName = user?.name?.split(' ')[0] ?? ''
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [demoDay, setDemoDay] = useState<DemoDayResult | null>(null)
  const seeded = !!me && me.memberships.length + me.parentOf.length > 0
  const staffRole = role === 'ea' || role === 'teacher'
  const today = useLoad(() => getToday(role), me && seeded && staffRole ? (role ?? '') : null)

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) success(ok)
    } catch (e) {
      toastError(t('app.home.devFailed'), e instanceof Error ? e.message : '')
    } finally {
      setBusy(false)
    }
  }

  if (!loading && role && START_PATH[role] !== '/home' && !devEnabled) return <Navigate to={START_PATH[role]} replace />

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <OnboardingRedirect />
      <PageHeader
        titleClassName="sm:text-hero"
        title={firstName ? <T k="app.home.greeting" vars={{ name: firstName }} /> : t('app.home.greetingNoName')}
        description={role ? t('app.home.actingAs', { role: t(ROLE_LABEL[role]) }) : t('app.home.intro')}
        actions={<LanguageSwitcher />}
      />

      {devEnabled && (
        <Card title={t('app.home.devTitle')} data-testid="dev-panel">
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <FlaskConical className="size-4" aria-hidden /> {t('app.home.devBody')}
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <Button disabled={busy} onClick={() => void run(seed, t('app.home.seeded'))}>
              {t('app.home.loadDemo')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setDemoDay(null)
                  setDemoDay(await runDemoDay())
                  await refresh()
                })
              }
            >
              {t('app.demoDay.run')}
            </Button>
            <Button variant="outline" disabled={busy || !seeded} onClick={() => setConfirmReset(true)}>
              {t('app.home.resetDemo')}
            </Button>
            <div className="flex flex-col gap-1">
              <span id="dev-role-label" className="text-label font-semibold">
                {t('app.home.actAs')}
              </span>
              <Select value={role ?? ''} disabled={busy || !seeded} onValueChange={(v) => v && void run(() => switchRole(v as AltamyraRole))}>
                <SelectTrigger aria-labelledby="dev-role-label" className="w-56">
                  <SelectValue placeholder={t('app.home.chooseRole')} />
                </SelectTrigger>
                <SelectContent>
                  {ALTAMYRA_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(ROLE_LABEL[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-body text-muted-foreground">{t('app.demoDay.hint')}</p>
          {busy && !demoDay && (
            <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
              <Spinner /> {t('app.demoDay.running')}
            </p>
          )}
          {demoDay && <DemoDayResults result={demoDay} />}
        </Card>
      )}

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('app.home.resetTitle')}</DialogTitle>
            <DialogDescription>{t('app.home.resetBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>
              {t('app.home.resetCancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmReset(false)
                void run(async () => {
                  await apiPost('/dev/seed', { reset: true })
                  await switchRole(role ?? 'case_manager')
                  if (staffRole) today.reload()
                }, t('app.home.resetDone'))
              }}
            >
              {t('app.home.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
          <Spinner /> {t('app.home.loading')}
        </p>
      ) : !me || !seeded ? (
        <Card>
          <EmptyState title={t('app.home.emptyTitle')} description={devEnabled ? t('app.home.emptyBodyDev') : t('app.home.emptyBody')} />
        </Card>
      ) : (
        <>
          {staffRole && today.status === 'loading' && (
            <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
              <Spinner /> {t('app.home.loading')}
            </p>
          )}
          {staffRole && today.status === 'error' && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-body text-destructive">
                {t('app.home.loadFailed')}
              </p>
              <Button variant="outline" onClick={today.reload}>
                {t('app.home.retry')}
              </Button>
            </div>
          )}
          {staffRole && today.status === 'ready' && today.data && (role === 'teacher' ? <TeacherHome today={today.data} /> : <EaHome today={today.data} />)}
          {role === 'case_manager' && <CaseManagerHome />}
        </>
      )}
    </div>
  )
}
