/**
 * Sign-up, two steps.
 *   1. Signed out: continue with Google or GitHub (public email sign-up is
 *      closed platform-wide; the account is created on the first OAuth sign-in).
 *   2. Signed in, profile incomplete: school, position and language, saved to
 *      the user's own `users` record the same way Settings does.
 * Signed in with school and position already set goes straight to `next`.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, useMutations, useQuery, useUser } from 'deepspace'
import { CircleAlert } from 'lucide-react'
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
import { APP_NAME } from '@/constants'

interface Profile {
  school?: string
  position?: string
  language?: string
}

// Same options as Settings.
const POSITIONS = [
  'Classroom teacher',
  'Resource / case-manager teacher',
  'Education assistant',
  'Substitute teacher',
  'Administrator',
  'District inclusive-education lead',
]

const GUTTER = 'px-4 py-6 sm:px-6 lg:py-6'

const INVALID_CLASS =
  'aria-invalid:border-destructive-strong aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive-strong)]'

/** Only same-origin paths: never `//host` or `/\\host` (browsers read both
 *  as another origin), and never back to an auth page, which would loop. */
function safeNext(raw: string | null) {
  return raw && /^\/(?![/\\]|sign-)/.test(raw) ? raw : '/home'
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-semibold text-muted-foreground">Step {step} of 2</p>
      <Progress value={step * 50} tone="signal" />
    </div>
  )
}

export default function SignUpPage() {
  const { isSignedIn } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(next)}` : ''
  const { error } = useToast()

  if (!isSignedIn) {
    return (
      <AuthLayout
        key="step-1"
        className={GUTTER}
        title="Create your account"
        description="Use your school Google or GitHub account. It takes a minute."
        aside="A living IEP for every learner in your class."
        footer={
          <>
            Already have an account?{' '}
            <Link to={`/sign-in${nextQuery}`} className="py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal">
              Sign in
            </Link>
          </>
        }
      >
        <div className="stagger-rise flex flex-col gap-6">
          <StepIndicator step={1} />
          {/* ponytail: the OAuth route always lands on /home, so step 2 only
              opens when the visitor returns here; /home should send
              incomplete profiles to /sign-up. */}
          <OAuthButtons onError={(m) => error('Could not open sign-in', m)} />
          <p className="text-small text-muted-foreground">
            Email sign-up isn&apos;t available. Accounts are created with Google or GitHub, so there is no new password to remember.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return <ProfileStep next={next} />
}

function ProfileStep({ next }: { next: string }) {
  const navigate = useNavigate()
  const { user, isLoading: userLoading } = useUser()
  const { success, error } = useToast()
  const { records, status } = useQuery<Profile>('users')
  const { put, ready } = useMutations<Profile>('users')
  // The users row is keyed by user id. Admins can read every row, so
  // records[0] is not necessarily theirs.
  const me = records.find((r) => r.recordId === user?.id)
  const recordId = me?.recordId

  const [school, setSchool] = useState('')
  const [position, setPosition] = useState('')
  const [language, setLanguage] = useState('en')
  const [consent, setConsent] = useState(false)
  const [touched, setTouched] = useState({ school: false, position: false, consent: false })
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  // Set once the form is complete, so the record update does not race the
  // submit handler's own navigate.
  const [done, setDone] = useState(false)

  const schoolRef = useRef<HTMLInputElement>(null)
  const positionRef = useRef<HTMLButtonElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)

  // Prefill a partly filled profile once per record, like Settings.
  useEffect(() => {
    const d = me?.data
    if (!d) return
    setSchool(d.school ?? '')
    setPosition(d.position ?? '')
    setLanguage(d.language || 'en')
  }, [recordId])

  const problems = {
    school: school.trim() ? '' : 'Enter your school name.',
    position: position ? '' : 'Choose your position.',
    consent: consent ? '' : 'Please confirm to continue.',
  }
  const show = (f: keyof typeof problems) => ((touched[f] || submitted) && problems[f]) || undefined
  const touch = (f: keyof typeof touched) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }))

  if (status === 'loading' || userLoading) {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center gap-3 text-body text-muted-foreground">
        <Spinner /> Loading your profile…
      </div>
    )
  }
  if (!done && me?.data?.school && me.data.position) return <Navigate to={next} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (problems.school) return schoolRef.current?.focus()
    if (problems.position) return positionRef.current?.focus()
    if (problems.consent) return consentRef.current?.focus()
    if (!recordId) {
      error('Could not save', 'Your account is still loading. Try again in a moment.')
      return
    }
    setSaving(true)
    setDone(true)
    try {
      await put(recordId, { school: school.trim(), position, language })
      success("You're all set.", 'Your dashboard is ready.')
      navigate(next, { replace: true })
    } catch {
      setDone(false)
      error('Could not save', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const consentError = show('consent')

  return (
    <AuthLayout
      key="step-2"
      className={GUTTER}
      title="Tell us about your class"
      description={`This helps ${APP_NAME} set up your dashboard. You can change it later in Settings.`}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-8">
        <div className="stagger-rise flex flex-col gap-4">
          <StepIndicator step={2} />

          <FormField label="Full name" hint="Set by your Google or GitHub account.">
            <Input readOnly value={user?.name || 'Not set'} autoComplete="name" className="bg-muted" />
          </FormField>

          <FormField label="School" required hint="The school where you teach this year." error={show('school')}>
            <Input
              ref={schoolRef}
              value={school}
              maxLength={120}
              onChange={(e) => setSchool(e.target.value)}
              onBlur={() => touch('school')}
              placeholder="e.g. Riverside Elementary"
              autoComplete="organization"
            />
          </FormField>

          <FormField label="Position" required hint="Sets what your dashboard shows first." error={show('position')}>
            {(control) => (
              <Select
                value={position}
                onValueChange={setPosition}
                onOpenChange={(open) => !open && touch('position')}
              >
                {/* Opening the list moves focus into it, which is not leaving the field. */}
                <SelectTrigger
                  ref={positionRef}
                  {...control}
                  className={INVALID_CLASS}
                  onBlur={(e) => !e.currentTarget.hasAttribute('data-popup-open') && touch('position')}
                >
                  <SelectValue placeholder="Choose your position" />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label="Preferred language" hint="Used for the app interface.">
            {(control) => (
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>

          <div className="flex flex-col">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-body">
              <input
                ref={consentRef}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                onBlur={() => touch('consent')}
                aria-required
                aria-invalid={consentError ? true : undefined}
                aria-describedby="consent-message"
                className="mt-1 size-5 shrink-0 cursor-pointer accent-foreground"
              />
              <span>
                I will only enter fictional or de-identified student information.
                <span aria-hidden className="ml-1 text-destructive-strong">*</span>
              </span>
            </label>
            <p id="consent-message" className="mt-1.5 min-h-5 text-small">
              {consentError ? (
                <span className="flex animate-in items-start gap-1.5 font-semibold text-destructive-strong fade-in-0">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="sr-only">Error: </span>
                    {consentError}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Pilot only: no real student data yet.</span>
              )}
            </p>
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={saving} disabled={!ready}>
          {saving ? 'Saving…' : 'Finish setting up'}
        </Button>
      </form>
    </AuthLayout>
  )
}
