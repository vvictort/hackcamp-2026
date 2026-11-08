import { useCallback } from 'react'
import { useLang } from '@/i18n'
import { en, type MessageKey } from '@/i18n/en'
import { capture } from '@/i18n/en/capture'

export type CaptureKey = keyof typeof capture
type Vars = Record<string, string | number>

/** Translate a capture.* key. Until the keys are registered in en.ts, fall back to the English text here. */
export function useCt() {
  const { t } = useLang()
  return useCallback(
    (key: CaptureKey, vars?: Vars): string => {
      if (key in en) return t(key as MessageKey, vars)
      const text: string = capture[key]
      return vars ? text.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m)) : text
    },
    [t],
  )
}
