/**
 * The root error screen. Self-contained on purpose: it renders as the root error boundary, replacing
 * the app shell, so it must not depend on app providers. It imports only
 * buttonVariants (no context) straight from ui/Button, not the
 * barrel, and reads its colours from the CSS variables in styles.css.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { buttonVariants } from './ui/Button'

export function ErrorScreen({ error }: { error: unknown }) {
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const stack = error instanceof Error ? error.stack : undefined

  return (
    <div
      data-testid="ds-error-boundary"
      className="flex h-full min-h-[60vh] flex-col items-center justify-center bg-background px-4 py-10 text-foreground"
    >
      <div className="w-full max-w-lg text-center">
        <div className="mb-4 flex justify-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <AlertTriangle className="h-6 w-6" aria-hidden />
          </span>
        </div>

        <h1 className="text-h1">Something went wrong</h1>

        {rawMessage && (
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-left text-small text-muted-foreground">
            {rawMessage}
          </pre>
        )}

        {stack && (
          <details className="mt-2 text-left">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-small text-muted-foreground">Show stack trace</summary>
            <pre className="mt-1 max-h-60 overflow-auto rounded-md border border-border bg-card px-3 py-2 text-small text-muted-foreground">
              {stack}
            </pre>
          </details>
        )}

        <div className="mt-6 flex items-center justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className={buttonVariants({ size: 'lg' })}>
            <RefreshCw className="size-5" aria-hidden />
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
