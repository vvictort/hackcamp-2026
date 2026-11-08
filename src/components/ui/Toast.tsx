import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { CircleAlert, CircleCheckBig, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'warning'

interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
}

type Notify = (title: string, description?: string) => void

interface ToastContextValue {
  success: Notify
  error: Notify
  warning: Notify
}

const MAX_TOASTS = 5

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const value = useMemo<ToastContextValue>(() => {
    const add = (type: ToastType): Notify => (title, description) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((prev) => [...prev, { id, type, title, description }].slice(-MAX_TOASTS))
    }
    return { success: add('success'), error: add('error'), warning: add('warning') }
  }, [])

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast viewport: fixed, outside every page's flow, so a toast never
          pushes content. `pointer-events-none` is load-bearing: this layer sits
          over one corner of every page, so without it the container silently
          eats clicks underneath. Each toast re-enables events for itself. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Per-type look: the whole toast takes its status fill with ink text
 * (10:1+ on every fill), and the icon plus a word say the type, so colour is
 * never the only cue.
 */
const TOAST_CONFIG = {
  success: { Icon: CircleCheckBig, word: 'Success', fill: 'bg-success text-success-foreground' },
  error:   { Icon: CircleAlert, word: 'Error', fill: 'bg-destructive text-destructive-foreground' },
  warning: { Icon: TriangleAlert, word: 'Warning', fill: 'bg-warning text-warning-foreground' },
} as const

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }): React.ReactElement {
  const { Icon, word, fill } = TOAST_CONFIG[toast.type]
  const [exiting, setExiting] = useState(false)

  // Auto-dismiss takes the same exit as the close button.
  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), 5000)
    return () => clearTimeout(timer)
  }, [])

  // Animate out before removing.
  useEffect(() => {
    if (exiting) {
      const timer = setTimeout(onDismiss, 150) // --duration-exit in styles.css
      return () => clearTimeout(timer)
    }
  }, [exiting, onDismiss])

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-90 max-w-full items-start gap-3 rounded-lg py-2 pl-4 pr-1 shadow-lift',
        fill,
        exiting ? 'animate-out fade-out-0 [--tw-exit-translate-x:1rem]' : 'animate-in fade-in-0 [--tw-enter-translate-x:1rem]',
      )}
      role={toast.type === 'success' ? 'status' : 'alert'}
    >
      <Icon className="mt-2.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 py-2">
        <p className="text-small font-bold">{word}</p>
        <p className="text-label font-semibold">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-small">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => setExiting(true)}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-foreground/10"
        aria-label="Dismiss"
      >
        <X className="size-5" aria-hidden />
      </button>
    </div>
  )
}
