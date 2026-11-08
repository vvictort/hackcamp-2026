/**
 * Dynamic app boundary — the auth + realtime data layer.
 *
 * `(app)` is a Generouted route group: the parentheses mean it does NOT appear
 * in the URL, so (app)/home.tsx is served at /home. Every page under this
 * folder is wrapped in the DeepSpace providers below, so it may call `useAuth`,
 * `useQuery`, `useMutations`, presence/Yjs hooks, etc.
 *
 * Pages OUTSIDE this folder (top level of src/pages/) get none of this — they
 * render as static pages with no auth fetch and no records WebSocket. Move a
 * page in or out of (app)/ to flip it between dynamic and static. Require
 * sign-in on top of the data layer by nesting under (app)/(protected)/.
 *
 * This is where the app chrome (Navigation) lives, so static pages can present
 * their own layout without inheriting it.
 */

import { Suspense, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router'
import { DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope, AgentTools } from 'deepspace'
import Navigation from '../../components/Navigation'
import { useToast } from '@/components/ui'
import { APP_NAME, SCOPE_ID } from '../../constants'
import { schemas } from '../../schemas'

/** Auth pages own the full viewport: no nav rail, no page gutter. */
const BARE_ROUTES = ['/sign-in', '/sign-up']

export default function AppLayout() {
  const bare = BARE_ROUTES.includes(useLocation().pathname)
  const outlet = (
    <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>}>
      <Outlet />
    </Suspense>
  )
  return (
    <DeepSpaceAuthProvider>
      {/* The prerendered landing owns the document <title> and React drops it
          when <Seo> unmounts, so every route without <Seo> sets its own. */}
      <title>{APP_NAME}</title>
      <AuthBoot>
        {/* Grey canvas; the nav rail floats as a white card and pages lay their
            own cards directly on the canvas. <main> owns the page gutter, so
            pages add none of their own. */}
        <div className="min-h-screen bg-background">
          {bare ? (
            <main className="min-h-screen">{outlet}</main>
          ) : (
            <div className="mx-auto flex min-h-screen max-w-370 flex-col lg:flex-row lg:gap-8 lg:p-6">
              <Navigation />
              <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-0 lg:py-0">{outlet}</main>
            </div>
          )}
        </div>
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

/**
 * Waits for auth to resolve, then mounts the data layer. Distinct from the SDK's `AuthGate`.
 *
 * While the initial session check is in flight, renders a fixed full-viewport
 * panel in the page background, visually identical to the pre-JS page
 * (index.html primes <html> with the same color), so a cold load shows a
 * steady background-coloured screen until the shell appears. No spinner text: the
 * check is one round-trip, and in-flow placeholders read as a layout jump.
 */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuthStatus()
  // Record writes (`create`/`put`/`remove`) are fire-and-forget — they resolve
  // before the server answers, so a denied or invalid write only surfaces
  // through onWriteError. Route rejections to toasts so they're never a
  // silent no-op. Keep this wiring when customizing the layout.
  const { error, warning } = useToast()

  if (!isLoaded) {
    return <div aria-busy="true" className="fixed inset-0 bg-background" />
  }

  return (
    <RecordProvider
      allowAnonymous
      onWriteError={(e) =>
        e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)
      }
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        <AgentTools />
        {children}
      </RecordScope>
    </RecordProvider>
  )
}
