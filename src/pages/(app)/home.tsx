/**
 * Altamira dashboard. Everything comes from the /api/v1 backend: Pulse is goal
 * data coverage (fresh, stale, data needed), Coming up is today's schedule and
 * the digest lists decision-rule alerts. The dev panel (load demo data, act as
 * a role) shows only when the backend has ALTAMIRA_DEV_SEED=true.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthProfileReady } from 'deepspace'
import { ArrowUpRight, CalendarDays, ClipboardCheck, FlaskConical, Hourglass, type LucideIcon } from 'lucide-react'
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
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui'
import { OnboardingRedirect } from '@/components/auth/onboarding'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useLang } from '@/i18n'
import { T } from '@/i18n/rich'
import type { MessageKey } from '@/i18n/en'
import { apiGet, apiPost, type ComingUpItem, type DigestItem } from '@/lib/altamira/api'
import { ALTAMIRA_ROLES, useAltamiraMe, type AltamiraRole } from '@/lib/altamira/role'
import { coverageOf, tallyCoverage, type Coverage, type CoverageCounts, type GoalStatusLite } from '@/lib/altamira/coverage'

const ROLE_LABEL: Record<AltamiraRole, MessageKey> = {
  case_manager: 'app.role.case_manager',
  teacher: 'app.role.teacher',
  ea: 'app.role.ea',
  parent: 'app.role.parent',
  student: 'app.role.student',
  district_lead: 'app.role.district_lead',
}

const RULE_LABEL: Record<DigestItem['decision']['rule'], MessageKey> = {
  below_aimline: 'app.home.ruleBelow',
  above_aimline: 'app.home.ruleAbove',
  data_needed: 'app.home.ruleDataNeeded',
}

const UP_META: Record<ComingUpItem['kind'], { Icon: LucideIcon; key: MessageKey; to: (id: string) => string }> = {
  iep_meeting: { Icon: CalendarDays, key: 'app.home.upIep', to: (id) => `/students/${id}` },
  review_queue: { Icon: ClipboardCheck, key: 'app.home.upReview', to: () => '/review' },
  data_due: { Icon: Hourglass, key: 'app.home.upData', to: () => '/capture' },
}

type Pulse = { counts: CoverageCounts; total: number }

export default function HomePage() {
  const { user } = useAuthProfileReady({ requireUser: true })
  const { error: toastError, success } = useToast()
  const { t } = useLang()
  const { role, devEnabled, me, loading, seed, switchRole } = useAltamiraMe()
  const firstName = user?.name?.split(' ')[0] ?? ''
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [pulse, setPulse] = useState<Pulse | null>(null)
  const [digest, setDigest] = useState<DigestItem[]>([])
  const [upcoming, setUpcoming] = useState<ComingUpItem[]>([])

  const staffStudents = me ? (me.caseload.length ? me.caseload : me.students) : []
  const staffKey = staffStudents.map((s) => s.id).join(',')
  const seeded = !!me && me.memberships.length + me.parentOf.length > 0

  const loadPulse = useCallback(async () => {
    const ids = staffKey ? staffKey.split(',') : []
    const statuses: GoalStatusLite[] = []
    await Promise.all(
      ids.map(async (id) => {
        try {
          const profile = await apiGet<{ goals?: { id: string }[] }>(`/students/${id}`)
          const results = await Promise.allSettled((profile.goals ?? []).map((g) => apiGet<GoalStatusLite>(`/students/${id}/goals/${g.id}/status`)))
          for (const r of results) if (r.status === 'fulfilled') statuses.push(r.value)
        } catch {
          /* no access to this student: skip */
        }
      }),
    )
    setPulse({ counts: tallyCoverage(statuses.map(coverageOf)), total: statuses.length })
    try {
      setDigest((await apiGet<{ items: DigestItem[] }>('/me/digest')).items)
    } catch {
      setDigest([])
    }
    try {
      setUpcoming((await apiGet<{ items: ComingUpItem[] }>('/me/coming-up')).items)
    } catch {
      setUpcoming([])
    }
  }, [staffKey])

  useEffect(() => {
    if (me && role !== 'parent' && role !== 'student' && role !== 'district_lead') void loadPulse()
    else {
      setPulse(null)
      setUpcoming([])
    }
  }, [me, role, loadPulse])

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

  const tokenOf = (studentId: string) => me?.students.concat(me.caseload).find((s) => s.id === studentId)?.displayToken ?? studentId.slice(0, 6)
  const coverageRow = (key: Coverage, tone: 'success' | 'warning' | 'destructive', label: MessageKey) => (
    <li key={key} className="flex items-center justify-between gap-3">
      <StatusBadge tone={tone}>{t(label)}</StatusBadge>
      <span className="text-h2 font-extrabold tabular-nums">{pulse?.counts[key] ?? 0}</span>
    </li>
  )
  const todayIso = new Date().toLocaleDateString('en-CA')
  const freshPct = pulse && pulse.total ? Math.round((pulse.counts.fresh / pulse.total) * 100) : 0

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
            <Button variant="outline" disabled={busy || !seeded} onClick={() => setConfirmReset(true)}>
              {t('app.home.resetDemo')}
            </Button>
            <div className="flex flex-col gap-1">
              <span id="dev-role-label" className="text-label font-semibold">
                {t('app.home.actAs')}
              </span>
              <Select value={role ?? ''} disabled={busy || !seeded} onValueChange={(v) => v && void run(() => switchRole(v as AltamiraRole))}>
                <SelectTrigger aria-labelledby="dev-role-label" className="w-56">
                  <SelectValue placeholder={t('app.home.chooseRole')} />
                </SelectTrigger>
                <SelectContent>
                  {ALTAMIRA_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(ROLE_LABEL[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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
                  await loadPulse()
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
        <div className="grid gap-6 lg:grid-cols-3">
          {pulse && (
            <Card title={t('app.home.pulseTitle')} className="lg:col-span-1">
              <p className="text-body text-muted-foreground">{t('app.home.pulseBody', { n: pulse.total })}</p>
              <Progress value={freshPct} label={t('app.home.pulseFreshLabel')} tone="signal" />
              <ul className="flex flex-col gap-3">
                {coverageRow('fresh', 'success', 'app.home.coverFresh')}
                {coverageRow('stale', 'warning', 'app.home.coverStale')}
                {coverageRow('data_needed', 'destructive', 'app.home.coverNeeded')}
              </ul>
            </Card>
          )}

          <Card title={t('app.home.comingUp')} className="lg:col-span-1">
            {me.todaySchedule.length === 0 && upcoming.length === 0 ? (
              <p className="text-body text-muted-foreground">{t('app.home.nothingToday')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {me.todaySchedule.map((b) => (
                  <li key={`${b.classId}-${b.startsAt}`} className="flex flex-col">
                    <span className="text-label font-semibold">
                      {b.startsAt} to {b.endsAt}
                    </span>
                    <span className="text-body">{b.lessonTitle ? `${b.className}: ${b.lessonTitle}` : b.className}</span>
                  </li>
                ))}
                {upcoming.map((u, i) => {
                  const { Icon, key, to } = UP_META[u.kind]
                  return (
                    <li key={`${u.kind}-${u.studentId}-${i}`}>
                      <Link to={to(u.studentId)} className="flex items-start gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
                        <Icon className="mt-1 size-4 shrink-0" aria-hidden />
                        <span className="flex flex-col">
                          <span className="text-label font-semibold">{u.date === todayIso ? t('app.home.upToday') : u.date}</span>
                          <span className="text-body">{t(key, { n: u.count ?? 0, student: tokenOf(u.studentId) })}</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {pulse && (
            <Card title={t('app.home.digestTitle')} className="lg:col-span-1">
              {digest.length === 0 ? (
                <p className="text-body text-muted-foreground">{t('app.home.digestEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {digest.map((d) => (
                    <li key={d.decision.id} className="flex items-center justify-between gap-3">
                      <span className="text-body font-semibold">{tokenOf(d.studentId)}</span>
                      <StatusBadge tone={d.decision.rule === 'above_aimline' ? 'success' : d.decision.rule === 'below_aimline' ? 'warning' : 'destructive'}>
                        {t(RULE_LABEL[d.decision.rule])}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {(role === 'teacher' || role === 'case_manager') && (
            <Card title={t('app.home.lessonLens')} className="lg:col-span-3">
              <p className="text-body text-muted-foreground">{t('app.home.lensCardBody')}</p>
              <Link
                to="/lesson-lens"
                className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-3 text-label font-bold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t('app.home.openLens')} <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
