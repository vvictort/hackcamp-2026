import { en } from './en'

/** Names the translator must leave exactly as they are. */
export const KEEP = 'Altamyra, MyEd, MyEducation BC, IEP, FESL, Pulse, Lesson Lens, Progress Drafts, Today View, Family Bridge, District Insights, QR'

/** Version of the English catalogue and the do-not-translate list. A saved translation with another version is stale. */
export function catalogueVersion(): string {
  let h = 5381
  for (const ch of JSON.stringify([en, KEEP])) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}
