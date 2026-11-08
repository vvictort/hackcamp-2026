/**
 * Language support. English strings live in ./en.ts; any other language is
 * fetched from /api/i18n/:lang (machine-translated once, then cached) and
 * missing keys fall back to English. First render is always English so the
 * prerendered pages hydrate cleanly; the saved language applies after mount.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './en'
import { DEFAULT_LANG, LANGUAGES, findLanguage, type Language } from './languages'
import { catalogueVersion } from './version'

type Messages = Partial<Record<MessageKey, string>>
type Vars = Record<string, string | number>

const STORAGE_KEY = 'altamyra.lang'

/** Translations committed to the repo (scripts/i18n-sync.mjs). Each loads on demand as its own small file. */
const locales = import.meta.glob<{ default: { v: string; messages: Messages } }>('./locales/*.json')

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

const savedKey = (lang: string) => `${STORAGE_KEY}.messages.${lang}`

function readSaved(lang: string): Messages | null {
  try {
    const raw = localStorage.getItem(savedKey(lang))
    return raw ? (JSON.parse(raw) as Messages) : null
  } catch {
    return null
  }
}

function writeSaved(lang: string, messages: Messages) {
  try {
    localStorage.setItem(savedKey(lang), JSON.stringify(messages))
  } catch {
    /* storage full or unavailable: the server copy still works */
  }
}

interface LangContextValue {
  lang: string
  languages: Language[]
  setLang: (code: string) => void
  /** True while a language is being fetched (English shows meanwhile). */
  loading: boolean
  /** True when the chosen language could not be loaded and English is showing. */
  failed: boolean
  t: (key: MessageKey, vars?: Vars) => string
}

const LangContext = createContext<LangContextValue | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(DEFAULT_LANG)
  const [messages, setMessages] = useState<Messages>({})
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => setLangState(initialLang()), [])

  useEffect(() => {
    const language = findLanguage(lang)
    document.documentElement.lang = lang
    document.documentElement.dir = language?.rtl ? 'rtl' : 'ltr'
    setFailed(false)
    if (lang === DEFAULT_LANG) {
      setMessages({})
      setLoading(false)
      return
    }
    // Show the best copy we already have at once, so there is no wait: the committed file, else the last
    // good copy this browser saw. Then ask the server only if that copy is missing or out of date.
    const saved = readSaved(lang)
    setMessages(saved ?? {})
    const ctrl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (attempt: number) => {
      setLoading(true)
      fetch(`/api/i18n/${lang}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ messages: Messages; complete?: boolean }>) : Promise.reject(new Error(String(r.status)))))
        .then((body) => {
          setMessages(body.messages)
          if (body.complete) writeSaved(lang, body.messages)
          // A partial result means the server is still filling gaps: ask again a few times.
          else if (attempt < 3) timer = setTimeout(() => load(attempt + 1), 8000)
        })
        .catch(() => !ctrl.signal.aborted && !saved && setFailed(true))
        .finally(() => !ctrl.signal.aborted && setLoading(false))
    }
    const file = locales[`./locales/${lang}.json`]
    if (!file) load(0)
    else {
      setLoading(true)
      file()
        .then((m) => {
          if (ctrl.signal.aborted) return
          setMessages(m.default.messages)
          if (m.default.v === catalogueVersion()) setLoading(false)
          else load(0) // the file is behind the English text: use it meanwhile, refresh from the server
        })
        .catch(() => !ctrl.signal.aborted && load(0))
    }
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
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
    () => ({ lang, languages: LANGUAGES, setLang, loading, failed, t: (key, vars) => translate(messages, key, vars) }),
    [lang, messages, loading, failed, setLang],
  )
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}
