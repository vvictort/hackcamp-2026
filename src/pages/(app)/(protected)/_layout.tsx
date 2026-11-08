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
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 */

import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Button, buttonVariants } from '@/components/ui'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-0 lg:py-0">
      <section className="flex max-w-md flex-col gap-5 rounded-lg bg-card p-6 shadow-raised">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold text-foreground">Sign in to continue</h1>
          <p className="text-body text-muted-foreground">This page is only available to signed-in users.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => setShowAuthModal(true)}>Sign in</Button>
          <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
            Back to home
          </Link>
        </div>
      </section>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
