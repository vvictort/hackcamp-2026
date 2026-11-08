import { useCallback } from 'react'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { drafts, type DraftsKey } from '@/i18n/en/drafts'

type Vars = Record<string, string | number>

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

/**
 * t() for drafts.* keys. Until the keys are registered in the main catalogue,
 * the lookup falls back to the English source in src/i18n/en/drafts.ts.
 */
export function useDraftsT() {
  const { t } = useLang()
  return useCallback(
    (key: DraftsKey, vars?: Vars): string => {
      try {
        const v = t(key as MessageKey, vars) as string | undefined
        if (typeof v === 'string') return v
      } catch {
        /* key not registered yet */
      }
      return fill(drafts[key], vars)
    },
    [t],
  )
}
