import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
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

/** Only same-origin paths, so ?next= can't send anyone off-site. */
function safeNext(raw: string | null) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/home'
}

export default function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const [params] = useSearchParams()
  const nextParam = params.get('next')
  const next = safeNext(nextParam)
  const carry = nextParam ? `?next=${encodeURIComponent(next)}` : ''
  const navigate = useNavigate()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Errors show after a field's first blur (or a submit), then track edits live.
  const [touched, setTouched] = useState({ email: false, password: false })
  const [pending, setPending] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

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
      title="Sign in"
      description="Welcome back. Sign in to see your class."
      className="px-4 py-6 sm:px-6 lg:py-6"
      footer={
        <p>
          New to {APP_NAME}?{' '}
          <Link to={`/sign-up${carry}`} className="font-semibold text-foreground underline underline-offset-4 hover:text-signal">
            Create an account
          </Link>
        </p>
      }
    >
      <OAuthButtons disabled={pending} onError={(m) => toast.error("Couldn't open sign-in.", m)} />

      <div className="flex items-center gap-3 text-small text-muted-foreground">
        <span aria-hidden className="h-px flex-1 bg-border" />
        or sign in with email
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>

      <form noValidate onSubmit={onSubmit} aria-label="Sign in with email" className="flex flex-col gap-6">
        <div className="stagger-rise flex flex-col gap-4">
          <FormField label="Email" required hint={`The email on your ${APP_NAME} account.`} error={emailError}>
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
          <FormField label="Password" required hint="Passwords are case-sensitive." error={passwordError}>
            <PasswordInput
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            />
          </FormField>
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
        <p className="text-small text-muted-foreground">
          Email sign-in works for existing accounts. New teachers can continue with Google or GitHub, or{' '}
          <Link to={`/sign-up${carry}`} className="font-semibold text-foreground underline underline-offset-4 hover:text-signal">
            create an account
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  )
}
