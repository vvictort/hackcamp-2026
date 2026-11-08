import { useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Mail } from 'lucide-react'
import { signIn, useAuth } from 'deepspace'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { startOnboarding } from '@/components/auth/onboarding'
import { APP_NAME } from '@/constants'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { Button, FormField, Input, PasswordInput, useToast } from '@/components/ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Validators return a message key ('' = valid); the component calls t() on it.
function validateEmail(v: string): MessageKey | '' {
  if (!v.trim()) return 'auth.signIn.emailRequired'
  if (!EMAIL_RE.test(v.trim())) return 'auth.signIn.emailInvalid'
  return ''
}
const validatePassword = (v: string): MessageKey | '' => (v ? '' : 'auth.signIn.passwordRequired')

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
  const { t } = useLang()

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

  const emailKey = touched.email ? validateEmail(email) : ''
  const passwordKey = touched.password ? validatePassword(password) : ''
  const emailError = emailKey && t(emailKey)
  const passwordError = passwordKey && t(passwordKey)

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
        toast.success(t('auth.signIn.successTitle'), t('auth.signIn.successMessage', { app: APP_NAME }))
        navigate(next, { replace: true })
        return
      }
      if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD') {
        toast.error(t('auth.signIn.wrongTitle'), t('auth.signIn.wrongMessage'))
        setPassword('')
        setTouched((t) => ({ ...t, password: false }))
        passwordRef.current?.focus()
      } else if (error.status === 429) {
        toast.warning(t('auth.signIn.tooManyTitle'), t('auth.signIn.tooManyMessage'))
      } else {
        toast.error(t('auth.signIn.failTitle'), error.message || t('auth.signIn.failMessage'))
      }
    } catch {
      toast.error(t('auth.signIn.networkTitle', { app: APP_NAME }), t('auth.signIn.networkMessage'))
    }
    setPending(false)
  }

  return (
    <AuthLayout
      title={emailStep ? t('auth.signIn.titleEmail') : t('auth.signIn.title')}
      description={emailStep ? t('auth.signIn.descriptionEmail') : t('auth.signIn.description')}
      className="px-4 py-6 sm:px-6 lg:py-6"
      footer={
        <p>
          {t('auth.signIn.newTo', { app: APP_NAME })}{' '}
          <Link
            to={`/sign-up?next=${encodeURIComponent(next)}`}
            className="py-3 font-semibold text-foreground underline underline-offset-4 hover:text-signal"
          >
            {t('auth.signIn.create')}
          </Link>
        </p>
      }
    >
      {emailStep ? (
        <form noValidate onSubmit={onSubmit} aria-label={t('auth.signIn.titleEmail')} className="stagger-rise flex flex-col gap-4">
          <FormField label={t('auth.signIn.email')} required error={emailError}>
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
          <FormField label={t('auth.signIn.password')} required error={passwordError}>
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
              {pending ? t('auth.signIn.submitting') : t('auth.signIn.submit')}
            </Button>
            <Button variant="link" disabled={pending} onClick={() => showEmail(false)}>
              <ArrowLeft aria-hidden />
              {t('auth.signIn.useOAuth')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="stagger-rise flex flex-col items-center gap-3">
          {/* A first Google/GitHub sign-in creates the account, so flag it: /home
              sends an incomplete profile to the sign-up stages (and consent). */}
          <OAuthButtons
            className="w-full"
            onStart={startOnboarding}
            onError={(m) => toast.error(t('auth.signIn.oauthErrorTitle'), m)}
          />
          <Button ref={toEmailRef} variant="link" onClick={() => showEmail(true)}>
            <Mail aria-hidden />
            {t('auth.signIn.withEmail')}
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}
