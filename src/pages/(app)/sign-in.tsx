import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { signIn, useAuth } from 'deepspace'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { APP_NAME } from '@/constants'
import { Button, FormField, Input, PasswordInput, useToast } from '@/components/ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmail(v: string) {
  if (!v.trim()) return 'Enter your email address.'
  if (!EMAIL_RE.test(v.trim())) return 'Enter an email like name@school.ca.'
  return ''
}
const validatePassword = (v: string) => (v ? '' : 'Enter your password.')

/** Only same-origin paths: never `//host` or `/\\host` (browsers read both
 *  as another origin), and never back to an auth page, which would loop. */
function safeNext(raw: string | null) {
  return raw && /^\/(?![/\\]|sign-)/.test(raw) ? raw : '/home'
}

export default function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const toast = useToast()

  // Two steps so the first screen stays calm: Google/GitHub (how teachers get
  // accounts), then email + password only for those who ask for it.
  const [emailStep, setEmailStep] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Errors show after a field's first blur (or a submit), then track edits live.
  const [touched, setTouched] = useState({ email: false, password: false })
  const [pending, setPending] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const toEmailRef = useRef<HTMLButtonElement>(null)

  // Swap steps, then move focus into the new content so keyboard and screen
  // reader users are not dropped on <body>.
  const showEmail = (on: boolean) => {
    flushSync(() => setEmailStep(on))
    ;(on ? emailRef : toEmailRef).current?.focus()
  }

  const emailError = touched.email ? validateEmail(email) : ''
  const passwordError = touched.password ? validatePassword(password) : ''

  // Signed in already, or the session just landed after a successful submit.
  if (isLoaded && isSignedIn && !pending) return <Navigate to={next} replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (pending) return
    setTouched({ email: true, password: true })
    if (validateEmail(email)) return emailRef.current?.focus()
    if (validatePassword(password)) return passwordRef.current?.focus()

    setPending(true)
    try {
      const { error } = await signIn.email({ email: email.trim(), password })
      if (!error) {
        toast.success('Signed in', `Welcome back to ${APP_NAME}.`)
        navigate(next, { replace: true })
        return
      }
      if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD') {
        toast.error('Email or password is incorrect.', 'Check both and try again.')
        setPassword('')
        setTouched((t) => ({ ...t, password: false }))
        passwordRef.current?.focus()
      } else if (error.status === 429) {
        toast.warning('Too many attempts.', 'Wait a minute, then try again.')
      } else {
        toast.error("Couldn't sign you in.", error.message || 'Please try again in a moment.')
      }
    } catch {
      toast.error(`Couldn't reach ${APP_NAME}.`, 'Check your connection and try again.')
    }
    setPending(false)
  }

  return (
    <AuthLayout
      title={emailStep ? 'Sign in with email' : 'Sign in'}
      description={emailStep ? 'For accounts that already have a password.' : 'Welcome back. Sign in to see your class.'}
      className="px-4 py-6 sm:px-6 lg:py-6"
      footer={
        <p>
          New to {APP_NAME}?{' '}
          <Link
            to={`/sign-up?next=${encodeURIComponent(next)}`}
            className="py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal"
          >
            Create an account
          </Link>
        </p>
      }
    >
      {emailStep ? (
        <form noValidate onSubmit={onSubmit} aria-label="Sign in with email" className="stagger-rise flex flex-col gap-4">
          <FormField label="Email" required error={emailError}>
            <Input
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />
          </FormField>
          <FormField label="Password" required error={passwordError}>
            <PasswordInput
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            />
          </FormField>
          <div className="flex flex-col items-center gap-3">
            <Button type="submit" size="lg" className="w-full" loading={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
            <Button variant="link" disabled={pending} onClick={() => showEmail(false)}>
              <ArrowLeft aria-hidden />
              Use Google or GitHub instead
            </Button>
          </div>
        </form>
      ) : (
        <div className="stagger-rise flex flex-col items-center gap-3">
          <OAuthButtons className="w-full" onError={(m) => toast.error("Couldn't open sign-in.", m)} />
          <Button ref={toEmailRef} variant="link" onClick={() => showEmail(true)}>
            <Mail aria-hidden />
            Sign in with email
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}
