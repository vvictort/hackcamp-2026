import type { ReactNode } from 'react'
import { useLang } from './index'
import type { MessageKey } from './en'

/** Inline tags allowed inside translated strings. The translator keeps them as-is. */
const TAGS: Record<string, (children: string, key: number) => ReactNode> = {
  hl: (c, k) => <span key={k} className="text-highlight">{c}</span>,
  muted: (c, k) => <span key={k} className="text-ink-muted">{c}</span>,
  b: (c, k) => <strong key={k}>{c}</strong>,
}

/** Turn "Make the <hl>IEP</hl> part of every lesson." into nodes. ponytail: tags do not nest. */
export function rich(text: string): ReactNode[] {
  return text.split(/(<(?:hl|muted|b)>.*?<\/(?:hl|muted|b)>)/gs).map((part, i) => {
    const m = /^<(hl|muted|b)>(.*)<\/\1>$/s.exec(part)
    return m ? TAGS[m[1]](m[2], i) : part
  })
}

/** A translated string with inline tags: <T k="landing.hero.title" /> */
export function T({ k, vars }: { k: MessageKey; vars?: Record<string, string | number> }) {
  const { t } = useLang()
  return <>{rich(t(k, vars))}</>
}
