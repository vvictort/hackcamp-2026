/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). It links to /sign-in and /sign-up with ?next=<current path> so
 * those pages can return the visitor here afterwards.
 */

import { Link, Outlet, useLocation } from 'react-router'
import { AuthGate } from 'deepspace'
import { buttonVariants, Card } from '@/components/ui'
import { useLang } from '@/i18n'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const { t } = useLang()
  const { pathname, search } = useLocation()
  const next = `?next=${encodeURIComponent(pathname + search)}`

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <Card className="animate-rise max-w-md gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold text-foreground">{t('app.gate.title')}</h1>
          <p className="text-body text-muted-foreground">{t('app.gate.body')}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link to={`/sign-in${next}`} className={buttonVariants()}>
            {t('common.signIn')}
          </Link>
          <Link to={`/sign-up${next}`} className={buttonVariants({ variant: 'secondary' })}>
            {t('app.gate.createAccount')}
          </Link>
        </div>
      </Card>
    </div>
  )
}
