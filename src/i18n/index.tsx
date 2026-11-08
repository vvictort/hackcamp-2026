/**
 * Language support. English strings live in ./en.ts; any other language is
 * fetched from /api/i18n/:lang (machine-translated once, then cached) and
 * missing keys fall back to English. First render is always English so the
 * prerendered pages hydrate cleanly; the saved language applies after mount.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './en'
import { DEFAULT_LANG, LANGUAGES, findLanguage, type Language } from './languages'

type Messages = Partial<Record<MessageKey, string>>
type Vars = Record<string, string | number>

const STORAGE_KEY = 'altamira.lang'

export function translate(messages: Messages, key: MessageKey, vars?: Vars): string {
  const text = messages[key] ?? en[key]
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text
}

/** Saved choice, else the browser's language if we support it, else English. */
function initialLang(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (findLanguage(saved)) return saved as string
  } catch {
    /* storage unavailable (private mode): fall through */
  }
  for (const tag of navigator.languages ?? []) {
    const hit =
      findLanguage(tag) ??
      findLanguage(tag.startsWith('zh') ? (/hant|tw|hk|mo/i.test(tag) ? 'zh-Hant' : 'zh-Hans') : tag.split('-')[0])
    if (hit) return hit.code
  }
  return DEFAULT_LANG
}

interface LangContextValue {
  lang: string
  languages: Language[]
  setLang: (code: string) => void
  /** True while a language is being fetched (English shows meanwhile). */
  loading: boolean
  t: (key: MessageKey, vars?: Vars) => string
}

const LangContext = createContext<LangContextValue | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(DEFAULT_LANG)
  const [messages, setMessages] = useState<Messages>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => setLangState(initialLang()), [])

  useEffect(() => {
    const language = findLanguage(lang)
    document.documentElement.lang = lang
    document.documentElement.dir = language?.rtl ? 'rtl' : 'ltr'
    if (lang === DEFAULT_LANG) {
      setMessages({})
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/i18n/${lang}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ messages: Messages }>) : Promise.reject(new Error(String(r.status)))))
      .then((body) => setMessages(body.messages))
      .catch(() => setMessages({}))
      .finally(() => !ctrl.signal.aborted && setLoading(false))
    return () => ctrl.abort()
  }, [lang])

  const setLang = useCallback((code: string) => {
    if (!findLanguage(code)) return
    setLangState(code)
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<LangContextValue>(
    () => ({ lang, languages: LANGUAGES, setLang, loading, t: (key, vars) => translate(messages, key, vars) }),
    [lang, messages, loading, setLang],
  )
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
