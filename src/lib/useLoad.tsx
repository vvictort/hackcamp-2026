import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '@/i18n'
import { ApiError } from '@/lib/altamyra/api'

export type Loaded<T> =
  | { status: 'loading'; data: null; error: null; reload: () => void }
  | { status: 'ready'; data: T; error: null; reload: () => void }
  | { status: 'error'; data: null; error: ApiError; reload: () => void }

/** Runs `fn` on mount and whenever `key` changes; `reload` refetches. A null key skips loading. */
export function useLoad<T>(fn: () => Promise<T>, key: string | null): Loaded<T> {
  const [state, setState] = useState<Omit<Loaded<T>, 'reload'>>({ status: 'loading', data: null, error: null } as Omit<Loaded<T>, 'reload'>)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (key === null) return
    let live = true
    fnRef
      .current()
      .then((data) => live && setState({ status: 'ready', data, error: null }))
      .catch((e: unknown) => live && setState({ status: 'error', data: null, error: e instanceof ApiError ? e : new ApiError(0, 'error', String(e)) }))
    return () => {
      live = false
    }
  }, [key, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, reload } as Loaded<T>
}

export function LoadError({ error, onRetry, className = 'text-small' }: { error: Error; onRetry?: () => void; className?: string }) {
  const { t } = useLang()
  return (
    <p role="alert" className={className}>
      {error.message}
      {onRetry && (
        <>
          {' '}
          <button type="button" className="font-semibold underline" onClick={onRetry}>
            {t('students.retry')}
          </button>
        </>
      )}
    </p>
  )
}
