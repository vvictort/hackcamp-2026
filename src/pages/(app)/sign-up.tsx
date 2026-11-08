/**
 * Sign-up in four short stages, one decision each.
 *   1. Signed out: continue with Google or GitHub (public email sign-up is
 *      closed platform-wide; the account is created on the first OAuth sign-in).
 *      OAuth always lands on /home, so a session flag brings a new account
 *      back here (see components/auth/onboarding.tsx).
 *   2. About you: name (from the OAuth account, read-only) and position.
 *   3. Your school: school and interface language (switches on pick).
 *   4. One last thing: the pilot data consent.
 * Finish is one put on the user's own `users` row. Answers live in state
 * (and sessionStorage, so a refresh keeps them) until then.
 * Signed in with school and position already set goes straight to `next`.
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, useMutations, useQuery, useUser } from 'deepspace'
import { ChevronLeft, CircleAlert } from 'lucide-react'
import {
  Button,
  FormField,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  useToast,
} from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import {
  endOnboarding,
  isComplete,
  loadDraft,
  saveDraft,
  startOnboarding,
  type Profile,
} from '@/components/auth/onboarding'
import { APP_NAME } from '@/constants'
import { LANGUAGES } from '@/i18n/languages'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { POSITIONS } from '@/lib/positions'
import { endSession } from '@/lib/session'

const GUTTER = 'px-4 py-6 sm:px-6 lg:py-6'
const TOTAL = 4

const INVALID_CLASS =
  'aria-invalid:border-destructive-strong aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive-strong)]'

type Stage = 2 | 3 | 4

const STAGES: Record<Stage, { title: MessageKey; description: MessageKey }> = {
  2: { title: 'auth.signUp.about.title', description: 'auth.signUp.about.description' },
  3: { title: 'auth.signUp.school.title', description: 'auth.signUp.school.description' },
  4: { title: 'auth.signUp.consent.title', description: 'auth.signUp.consent.description' },
}

/** Display label per stored position value (the English value is what is saved). */
const POSITION_KEY: Record<(typeof POSITIONS)[number], MessageKey> = {
  'Classroom teacher': 'auth.position.classroom-teacher',
  'Resource / case-manager teacher': 'auth.position.resource-teacher',
  'Education assistant': 'auth.position.education-assistant',
  'Substitute teacher': 'auth.position.substitute-teacher',
  Administrator: 'auth.position.administrator',
  'District inclusive-education lead': 'auth.position.district-lead',
}

/** Only same-origin paths: never `//host` or `/\\host` (browsers read both
 *  as another origin), and never back to an auth page, which would loop. */
function safeNext(raw: string | null) {
  return raw && /^\/(?![/\\]|sign-)/.test(raw) ? raw : '/home'
}

/** Visible step text and bar. Screen readers get the step from the h1 instead. */
function StepIndicator({ step }: { step: number }) {
  const { t } = useLang()
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <p className="text-small font-semibold text-muted-foreground">
        {t('auth.step.of', { current: step, total: TOTAL })}
      </p>
      <Progress
        value={(step / TOTAL) * 100}
        tone="signal"
        className="[&>div]:transition-[width] [&>div]:duration-(--duration-enter)"
      />
    </div>
  )
}

const stepTitle = (t: ReturnType<typeof useLang>['t'], step: number, title: string) => (
  <>
    <span className="sr-only">{t('auth.step.of', { current: step, total: TOTAL })}: </span>
    {title}
  </>
)

export default function SignUpPage() {
  const { isSignedIn } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(next)}` : ''
  const { error } = useToast()
  const { t } = useLang()

  if (!isSignedIn) {
    return (
      <AuthLayout
        className={GUTTER}
        eyebrow={<StepIndicator step={1} />}
        title={stepTitle(t, 1, t('auth.signUp.account.title'))}
        description={t('auth.signUp.account.description')}
        aside={t('auth.signUp.aside')}
        footer={
          <>
            {t('auth.signUp.account.haveOne')}{' '}
            <Link to={`/sign-in${nextQuery}`} className="py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal">
              {t('auth.signUp.account.signIn')}
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <OAuthButtons onStart={startOnboarding} onError={(m) => error(t('auth.signUp.oauthErrorTitle'), m)} />
          <p className="text-small text-muted-foreground">
            {t('auth.signUp.account.note')}
          </p>
        </div>
      </AuthLayout>
    )
  }

  return <ProfileStages next={next} />
}

interface Draft {
  stage: Stage
  school: string
  position: string
  language: string
}

function initialDraft(): Draft {
  const d = loadDraft<Draft>()
  return {
    stage: d.stage === 3 || d.stage === 4 ? d.stage : 2,
    school: typeof d.school === 'string' ? d.school : '',
    position: POSITIONS.find((p) => p === d.position) ?? '',
    language: LANGUAGES.find((l) => l.code === d.language)?.code ?? '',
  }
}

function ProfileStages({ next }: { next: string }) {
  const navigate = useNavigate()
  const { user, isLoading: userLoading } = useUser()
  const { lang, setLang, t } = useLang()
  const { success, error } = useToast()
  const { records, status } = useQuery<Profile>('users')
  const { put, ready } = useMutations<Profile>('users')
  // The users row is keyed by user id. Admins can read every row, so
  // records[0] is not necessarily theirs.
  const me = records.find((r) => r.recordId === user?.id)
  const recordId = me?.recordId
  const complete = isComplete(me?.data)

  const [draft, setDraft] = useState(initialDraft)
  const [consent, setConsent] = useState(false)
  // Errors show once Continue is pressed on a stage, then track edits live.
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  // Set once finishing, so the record update does not race the submit
  // handler's own navigate.
  const [done, setDone] = useState(false)

  const headingRef = useRef<HTMLHeadingElement>(null)
  const positionRef = useRef<HTMLButtonElement>(null)
  const schoolRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)

  const { stage } = draft
  const language = draft.language || lang
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // Prefill a partly filled profile once per record, keeping anything typed.
  useEffect(() => {
    const d = me?.data
    if (!d) return
    setDraft((v) => ({
      ...v,
      school: v.school || d.school || '',
      position: v.position || d.position || '',
      language: v.language || d.language || '',
    }))
  }, [recordId])
  useEffect(() => saveDraft(draft), [draft])
  // Each stage re-mounts its heading; move focus there so the change is announced.
  useEffect(() => headingRef.current?.focus(), [stage])
  useEffect(() => {
    if (complete && !done) endOnboarding()
  }, [complete, done])

  if (status === 'loading' || userLoading) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center gap-3 text-body text-muted-foreground">
        <Spinner /> {t('auth.signUp.loading')}
      </div>
    )
  }
  if (!done && complete) return <Navigate to={next} replace />

  const problems: Record<Stage, string> = {
    2: draft.position ? '' : t('auth.signUp.about.positionError'),
    3: draft.school.trim() ? '' : t('auth.signUp.school.schoolError'),
    4: consent ? '' : t('auth.signUp.consent.error'),
  }
  const problem = (tried && problems[stage]) || undefined

  function back() {
    setTried(false)
    update({ stage: (stage - 1) as Stage })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (problems[stage]) {
      setTried(true)
      ;({ 2: positionRef, 3: schoolRef, 4: consentRef })[stage].current?.focus()
      return
    }
    setTried(false)
    if (stage < 4) return update({ stage: (stage + 1) as Stage })

    if (!recordId) {
      error(t('auth.signUp.saveErrorTitle'), t('auth.signUp.accountLoading'))
      return
    }
    setSaving(true)
    setDone(true)
    try {
      await put(recordId, {
        school: draft.school.trim(),
        position: draft.position,
        language,
        consentAt: new Date().toISOString(),
      })
      endOnboarding()
      success(t('auth.signUp.doneTitle'), t('auth.signUp.doneMessage'))
      navigate(next, { replace: true })
    } catch {
      setDone(false)
      error(t('auth.signUp.saveErrorTitle'), t('auth.signUp.saveNetwork'))
    } finally {
      setSaving(false)
    }
  }

  // Enter on the consent checkbox submits too (browsers only do it from text fields).
  const enterSubmits = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLInputElement).type === 'checkbox') {
      e.preventDefault()
      e.currentTarget.requestSubmit()
    }
  }

  return (
    <AuthLayout
      className={GUTTER}
      contentKey={stage}
      headingRef={headingRef}
      eyebrow={<StepIndicator step={stage} />}
      title={stepTitle(t, stage, t(STAGES[stage].title))}
      description={t(STAGES[stage].description)}
      aside={t('auth.signUp.aside')}
      footer={
        <>
          {t('auth.signUp.signedInAs', { who: user?.email || user?.name || t('auth.signUp.you') })}{' '}
          <button
            type="button"
            onClick={() => {
              // Drop this account's saved answers so the next account starts clean.
              endOnboarding()
              void endSession('/sign-up')
            }}
            className="cursor-pointer py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal"
          >
            {t('auth.signUp.signOut')}
          </button>
        </>
      }
    >
      <form noValidate onSubmit={submit} onKeyDown={enterSubmits} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          {stage === 2 && (
            <>
              <FormField label={t('auth.signUp.about.name')} hint={t('auth.signUp.about.nameHint')}>
                <Input
                  readOnly
                  value={user?.name || t('auth.signUp.about.notSet')}
                  autoComplete="name"
                  className="bg-muted enabled:hover:border-input"
                />
              </FormField>
              <FormField label={t('auth.signUp.about.position')} required hint={t('auth.signUp.about.positionHint')} error={problem}>
                {(control) => (
                  <Select value={draft.position} onValueChange={(position) => update({ position })}>
                    <SelectTrigger ref={positionRef} {...control} className={INVALID_CLASS}>
                      <SelectValue placeholder={t('auth.signUp.about.positionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {POSITIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {t(POSITION_KEY[p])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </>
          )}

          {stage === 3 && (
            <>
              <FormField label={t('auth.signUp.school.school')} required hint={t('auth.signUp.school.schoolHint')} error={problem}>
                <Input
                  ref={schoolRef}
                  value={draft.school}
                  maxLength={120}
                  onChange={(e) => update({ school: e.target.value })}
                  placeholder={t('auth.signUp.school.schoolPlaceholder')}
                  autoComplete="organization"
                />
              </FormField>
              <FormField label={t('auth.signUp.school.language')} hint={t('auth.signUp.school.languageHint')}>
                {(control) => (
                  <Select
                    value={language}
                    onValueChange={(code) => {
                      update({ language: code })
                      setLang(code)
                    }}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.code} value={l.code} lang={l.code} dir={l.rtl ? 'rtl' : 'ltr'}>
                          {l.native}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </>
          )}

          {stage === 4 && (
            <div className="flex flex-col">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-4 text-body has-[:checked]:border-foreground">
                <input
                  ref={consentRef}
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-required
                  aria-invalid={problem ? true : undefined}
                  aria-describedby="consent-message"
                  className="mt-0.5 size-5 shrink-0 cursor-pointer accent-foreground"
                />
                <span>
                  {t('auth.signUp.consent.label')}
                  <span aria-hidden className="ms-1 text-destructive-strong">*</span>
                </span>
              </label>
              <p id="consent-message" className="mt-1.5 min-h-10 text-small">
                {problem ? (
                  <span className="flex animate-in items-start gap-1.5 font-semibold text-destructive-strong fade-in-0">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="sr-only">{t('auth.field.error')} </span>
                      {problem}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t('auth.signUp.consent.hint')}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          {stage > 2 && (
            <Button type="button" variant="ghost" size="lg" onClick={back} disabled={saving}>
              <ChevronLeft aria-hidden className="rtl:rotate-180" />
              {t('auth.signUp.back')}
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" loading={saving} disabled={stage === 4 && !ready}>
            {stage < 4 ? t('auth.signUp.continue') : saving ? t('auth.signUp.saving') : t('auth.signUp.finish')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
