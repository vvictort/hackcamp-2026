/**
 * Toast Notification System
 *
 * Self-contained toast provider with success/error/warning/info variants.
 * Uses the theme's semantic color tokens (success, warning, info, destructive).
 *
 * @example
 * // Wrap your app once:
 * <ToastProvider position="bottom-right">
 *   <App />
 * </ToastProvider>
 *
 * // In any child component:
 * const { success, error, warning, info } = useToast()
 * success('Saved!', 'Your changes have been saved.')
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (options: Omit<Toast, 'id'>) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
  dismiss: (id: string) => void
  dismissAll: () => void
}

// ============================================================================
// Icons (inline SVGs — no external dependency)
// ============================================================================

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ============================================================================
// Context
// ============================================================================

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ============================================================================
// ToastProvider
// ============================================================================

interface ToastProviderProps {
  children: ReactNode
  position?:
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'bottom-center'
  maxToasts?: number
}

export function ToastProvider({
  children,
  position = 'bottom-right',
  maxToasts = 5,
}: ToastProviderProps): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    setToasts([])
  }, [])

  const addToast = useCallback(
    (options: Omit<Toast, 'id'>) => {
      const id = Math.random().toString(36).slice(2)

      // Auto-dismiss is timed in ToastItem, so it plays the exit animation.
      setToasts((prev) => {
        const next = [...prev, { ...options, id }]
        return next.slice(-maxToasts)
      })
    },
    [maxToasts],
  )

  const toast = useCallback(
    (options: Omit<Toast, 'id'>) => addToast(options),
    [addToast],
  )
  const success = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'success', title, description }),
    [addToast],
  )
  const error = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'error', title, description }),
    [addToast],
  )
  const warning = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'warning', title, description }),
    [addToast],
  )
  const info = useCallback(
    (title: string, description?: string) =>
      addToast({ type: 'info', title, description }),
    [addToast],
  )

  return (
    <ToastContext.Provider
      value={{ toasts, toast, success, error, warning, info, dismiss, dismissAll }}
    >
      {children}

      {/* Toast viewport: fixed, outside every page's flow, so a toast never
          pushes content. `pointer-events-none` is load-bearing: this layer sits
          over one corner of every page, so without it the container silently
          eats clicks underneath. Each toast re-enables events for itself. */}
      <div
        className={cn(
          'pointer-events-none fixed z-[100] flex max-w-[calc(100vw-2rem)] flex-col gap-2',
          POSITION[position].viewport,
        )}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} position={position} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

type ToastPosition = NonNullable<ToastProviderProps['position']>

/** Where the viewport sits, and the edge each toast slides in from (1rem,
 *  --duration-pop on --ease-out) and back out to (--duration-exit, --ease-in). */
const POSITION: Record<ToastPosition, { viewport: string; enter: string; exit: string }> = {
  'top-right': { viewport: 'top-4 right-4', enter: '[--tw-enter-translate-x:1rem]', exit: '[--tw-exit-translate-x:1rem]' },
  'bottom-right': { viewport: 'bottom-4 right-4', enter: '[--tw-enter-translate-x:1rem]', exit: '[--tw-exit-translate-x:1rem]' },
  'top-left': { viewport: 'top-4 left-4', enter: '[--tw-enter-translate-x:-1rem]', exit: '[--tw-exit-translate-x:-1rem]' },
  'bottom-left': { viewport: 'bottom-4 left-4', enter: '[--tw-enter-translate-x:-1rem]', exit: '[--tw-exit-translate-x:-1rem]' },
  'top-center': { viewport: 'top-4 left-1/2 -translate-x-1/2', enter: '[--tw-enter-translate-y:-1rem]', exit: '[--tw-exit-translate-y:-1rem]' },
  'bottom-center': { viewport: 'bottom-4 left-1/2 -translate-x-1/2', enter: '[--tw-enter-translate-y:1rem]', exit: '[--tw-exit-translate-y:1rem]' },
}

// ============================================================================
// ToastItem
// ============================================================================

/**
 * Per-type look: the whole toast takes its status fill with ink text
 * (10:1+ on every fill), and the icon plus a word say the type, so colour is
 * never the only cue.
 */
const TOAST_CONFIG = {
  success: { Icon: CheckCircleIcon, word: 'Success', fill: 'bg-success text-success-foreground' },
  error:   { Icon: AlertCircleIcon, word: 'Error', fill: 'bg-destructive text-destructive-foreground' },
  warning: { Icon: AlertTriangleIcon, word: 'Warning', fill: 'bg-warning text-warning-foreground' },
  info:    { Icon: InfoIcon, word: 'Info', fill: 'bg-info text-info-foreground' },
} as const

interface ToastItemProps {
  toast: Toast
  position: ToastPosition
  onDismiss: () => void
}

function ToastItem({ toast, position, onDismiss }: ToastItemProps): React.ReactElement {
  const { Icon, word, fill } = TOAST_CONFIG[toast.type]
  const motion = POSITION[position]
  const [exiting, setExiting] = useState(false)

  // Auto-dismiss takes the same exit as the close button.
  useEffect(() => {
    const duration = toast.duration ?? 5000
    if (duration <= 0) return
    const timer = setTimeout(() => setExiting(true), duration)
    return () => clearTimeout(timer)
  }, [toast.duration])

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
        exiting ? cn('animate-out fade-out-0', motion.exit) : cn('animate-in fade-in-0', motion.enter),
      )}
      role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
    >
      <Icon className="mt-2.5 size-5 shrink-0" />
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
        <CloseIcon className="size-5" />
      </button>
    </div>
  )
}
