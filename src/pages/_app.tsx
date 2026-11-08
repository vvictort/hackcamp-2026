/**
 * Root shell — wraps every route, static and dynamic alike.
 *
 * This layout deliberately mounts NO DeepSpace providers, so a page placed at
 * the top level of src/pages/ (like index.tsx) renders as a plain static page:
 * no auth session fetch, no records WebSocket, no Durable Object connection.
 *
 * The auth + realtime data layer lives one level down, in (app)/_layout.tsx.
 * Any page that needs `useAuth`, `useQuery`, `useMutations`, etc. must live
 * under src/pages/(app)/ (or (app)/(protected)/ to also require sign-in).
 * See https://docs.deep.space/guides/authentication § "Mixed (default)".
 *
 * ToastProvider is local UI state (src/components/ui), not a network surface,
 * so it's safe to mount here for every page.
 *
 * Smooth scrolling: Lenis, once for every page. The wheel and in-page links
 * (#faq) share one glide (GLIDE below) and links then move keyboard focus to
 * the target. Lenis honours
 * prefers-reduced-motion (instant, 1:1 scrolling), pauses while a dialog locks
 * the page (autoToggle) and lets menus/lists scroll on their own
 * (allowNestedScroll). Created in an effect, so prerendering never touches it.
 */

import { Suspense, useEffect } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { Outlet, useRouteError } from 'react-router-dom'
import { ErrorScreen } from '../components/ErrorScreen'
import { ToastProvider, TooltipProvider } from '@/components/ui'

/* One glide for the wheel and anchor links: Lenis's own expo-out curve, the
   same as --ease-out in styles.css (cubic-bezier(0.16, 1, 0.3, 1)). CSS
   entrances use that curve too, so the page moves as one system. */
const GLIDE = { duration: 1.2, easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)) }

function useLenis() {
  useEffect(() => {
    const lenis = new Lenis({ ...GLIDE, autoRaf: true, autoToggle: true, allowNestedScroll: true })
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      const target = link && document.getElementById(link.hash.slice(1))
      if (!link || !target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
      event.preventDefault()
      history.pushState(null, '', link.hash)
      lenis.scrollTo(target, {
        onComplete: () => {
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
          target.focus({ preventScroll: true })
        },
      })
    }
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('click', onClick)
      lenis.destroy()
    }
  }, [])
}

export default function App() {
  useLenis()
  return (
    <ToastProvider>
      {/* The single TooltipProvider: owns the hover delay for every Tooltip
          and groups them so adjacent triggers switch instantly. Tune delay
          here — per-Tooltip providers would shadow it (see ui/Tooltip.tsx). */}
      <TooltipProvider>
        {/* data-testid="app-root" is the canonical "app shell mounted" hook,
            present on every page (static and dynamic). Don't rename without
            updating templates/tests. */}
        <div data-testid="app-root" className="min-h-screen bg-background text-foreground">
          <Suspense fallback={<div role="status" className="flex items-center justify-center min-h-screen text-muted-foreground">Loading...</div>}>
            <Outlet />
          </Suspense>
        </div>
      </TooltipProvider>
    </ToastProvider>
  )
}

/**
 * Root error boundary. Generouted wires a `_app` `Catch` export to the root
 * route's errorElement, so any render-time crash in a page — a thrown error,
 * or a hooks-rule violation like React #310 — lands here instead of React
 * Router's raw minified screen. ErrorScreen decodes the error for the developer.
 */
export function Catch() {
  const error = useRouteError()
  return <ErrorScreen error={error} />
}

