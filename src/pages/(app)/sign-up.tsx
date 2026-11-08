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
import { POSITIONS } from '@/lib/positions'
import { endSession } from '@/lib/session'

const GUTTER = 'px-4 py-6 sm:px-6 lg:py-6'
const ASIDE = 'A living IEP for every learner in your class.'
const TOTAL = 4

const INVALID_CLASS =
  'aria-invalid:border-destructive-strong aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive-strong)]'

type Stage = 2 | 3 | 4

const STAGES: Record<Stage, { title: string; description: string }> = {
  2: { title: 'About you', description: `So ${APP_NAME} can show you the right things first.` },
  3: { title: 'Your school', description: 'Where you teach, and the language you want to use.' },
  4: { title: 'One last thing', description: "This pilot isn't ready for real student records yet." },
}

/** Only same-origin paths: never `//host` or `/\\host` (browsers read both
 *  as another origin), and never back to an auth page, which would loop. */
function safeNext(raw: string | null) {
  return raw && /^\/(?![/\\]|sign-)/.test(raw) ? raw : '/home'
}

/** Visible step text and bar. Screen readers get the step from the h1 instead. */
function StepIndicator({ step }: { step: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <p className="text-small font-semibold text-muted-foreground">
        Step {step} of {TOTAL}
      </p>
      <Progress
        value={(step / TOTAL) * 100}
        tone="signal"
        className="[&>div]:transition-[width] [&>div]:duration-(--duration-enter)"
      />
    </div>
  )
}

const stepTitle = (step: number, title: string) => (
  <>
    <span className="sr-only">
      Step {step} of {TOTAL}:{' '}
    </span>
    {title}
  </>
)

export default function SignUpPage() {
  const { isSignedIn } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(next)}` : ''
  const { error } = useToast()

  if (!isSignedIn) {
    return (
      <AuthLayout
        className={GUTTER}
        eyebrow={<StepIndicator step={1} />}
        title={stepTitle(1, 'Create your account')}
        description="Use your school Google or GitHub account. It takes a minute."
        aside={ASIDE}
        footer={
          <>
            Already have an account?{' '}
            <Link to={`/sign-in${nextQuery}`} className="py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal">
              Sign in
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <OAuthButtons onStart={startOnboarding} onError={(m) => error('Could not open sign-in', m)} />
          <p className="text-small text-muted-foreground">
            There&apos;s no email sign-up: your Google or GitHub account is your login, so there&apos;s no new password to remember.
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
  const { lang, setLang } = useLang()
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
        <Spinner /> Loading your profile…
      </div>
    )
  }
  if (!done && complete) return <Navigate to={next} replace />

  const problems: Record<Stage, string> = {
    2: draft.position ? '' : 'Choose your position.',
    3: draft.school.trim() ? '' : 'Enter your school name.',
    4: consent ? '' : 'Please confirm to continue.',
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
      error('Could not save', 'Your account is still loading. Try again in a moment.')
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
      success("You're all set.", 'Your dashboard is ready.')
      navigate(next, { replace: true })
    } catch {
      setDone(false)
      error('Could not save', 'Check your connection and try again.')
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
      title={stepTitle(stage, STAGES[stage].title)}
      description={STAGES[stage].description}
      aside={ASIDE}
      footer={
        <>
          Signed in as {user?.email || user?.name || 'you'}. Not you?{' '}
          <button
            type="button"
            onClick={() => endSession('/sign-up')}
            className="cursor-pointer py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal"
          >
            Sign out
          </button>
        </>
      }
    >
      <form noValidate onSubmit={submit} onKeyDown={enterSubmits} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          {stage === 2 && (
            <>
              <FormField label="Full name" hint="From your Google or GitHub account.">
                <Input
                  readOnly
                  value={user?.name || 'Not set'}
                  autoComplete="name"
                  className="bg-muted enabled:hover:border-input"
                />
              </FormField>
              <FormField label="Position" required hint="Sets what your dashboard shows first." error={problem}>
                {(control) => (
                  <Select value={draft.position} onValueChange={(position) => update({ position })}>
                    <SelectTrigger ref={positionRef} {...control} className={INVALID_CLASS}>
                      <SelectValue placeholder="Choose your position" />
                    </SelectTrigger>
                    <SelectContent>
                      {POSITIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
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
              <FormField label="School" required hint="The school where you teach this year." error={problem}>
                <Input
                  ref={schoolRef}
                  value={draft.school}
                  maxLength={120}
                  onChange={(e) => update({ school: e.target.value })}
                  placeholder="e.g. Riverside Elementary"
                  autoComplete="organization"
                />
              </FormField>
              <FormField label="Preferred language" hint="The app switches as soon as you choose.">
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
                        <SelectItem key={l.code} value={l.code} lang={l.code}>
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
                  I will only enter fictional or de-identified student information.
                  <span aria-hidden className="ml-1 text-destructive-strong">*</span>
                </span>
              </label>
              <p id="consent-message" className="mt-1.5 min-h-10 text-small">
                {problem ? (
                  <span className="flex animate-in items-start gap-1.5 font-semibold text-destructive-strong fade-in-0">
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="sr-only">Error: </span>
                      {problem}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Use made-up names or initials, and leave out anything that could identify a student.
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
              Back
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" loading={saving} disabled={stage === 4 && !ready}>
            {stage < 4 ? 'Continue' : saving ? 'Saving…' : 'Finish setting up'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
