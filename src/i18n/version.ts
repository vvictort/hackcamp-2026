import { en } from './en'

/** Names the translator must leave exactly as they are. */
export const KEEP = 'Altamyra, MyEd, MyEducation BC, IEP, FESL, Pulse, Lesson Lens, Progress Drafts, Today View, Family Bridge, District Insights, QR'

/** Small stable string hash (djb2, base 36). Used to tell whether one English string changed. */
export function hashText(text: string): string {
  let h = 5381
  for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}

/** Version of the English catalogue and the do-not-translate list. A saved translation with another version is stale. */
export function catalogueVersion(): string {
  return hashText(JSON.stringify([en, KEEP]))
}

/** Hash of every English string by key: a translation is still good when its recorded hash matches. */
export function sourceHashes(): Record<string, string> {
  return Object.fromEntries(Object.entries(en).map(([k, v]) => [k, hashText(v as string)]))
}

/**
 * The translations in `messages` that are still correct for today's English: all of them when the version
 * matches, otherwise only the keys whose recorded source hash (`src`) still matches. Without `src` a stale
 * set cannot be checked, so it is kept whole (better than English) and refreshed in the background.
 */
export function freshMessages(file: { v: string; keep?: string; src?: Record<string, string>; messages: Record<string, string> }): Record<string, string> {
  if (file.v === catalogueVersion()) return file.messages
  if (!file.src) return file.messages
  if (file.keep !== hashText(KEEP)) return {}
  const now = sourceHashes()
  return Object.fromEntries(Object.entries(file.messages).filter(([k]) => now[k] !== undefined && file.src![k] === now[k]))
}
