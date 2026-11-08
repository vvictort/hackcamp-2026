/**
 * The English source strings: the ONLY text the translator ever sees. The
 * server translates this object, nothing else, so no user or record data can
 * reach the model. Keys are `area.name`. Use {name} placeholders for values
 * (filled in by t(), never changed by the translator) and <hl>, <b>, <muted>
 * tags for inline emphasis (rendered by <T>, kept by the translator).
 *
 * Add a string to the file for its area, then show it with t('key') or <T k="key" />.
 */
import { app } from './en/app'
import { auth } from './en/auth'
import { capture } from './en/capture'
import { common } from './en/common'
import { drafts } from './en/drafts'
import { insights } from './en/insights'
import { landing } from './en/landing'
import { lens } from './en/lens'
import { students } from './en/students'

export const en = { ...common, ...landing, ...app, ...auth, ...lens, ...students, ...capture, ...drafts, ...insights } as const

export type MessageKey = keyof typeof en
