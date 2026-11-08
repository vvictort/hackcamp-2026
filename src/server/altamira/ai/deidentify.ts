/**
 * De-identification for every AI call (design doc "AI module", Product
 * Analysis "AI pipeline"): names and identifiers become stable tokens and
 * identifying fields are dropped before a provider sees the input. The map
 * stays local and reidentify() restores names in the output.
 */

export type RosterStudent = {
  /** SchoolStudent.displayToken, e.g. "S-K7Q4". Used as the student's token in AI calls. */
  token: string
  firstName: string
  lastName: string
  preferredName?: string | null
  studentNumber?: string | null
  /** YYYY-MM-DD */
  dateOfBirth?: string | null
  email?: string | null
}

/** Staff and family members. */
export type RosterPerson = {
  displayName: string
  email?: string | null
}

export type Roster = {
  students: RosterStudent[]
  people: RosterPerson[]
  /** School and district names. */
  schools: string[]
}

/** token -> original text. Never sent to a provider. */
export type DeidMap = { tokens: Record<string, string> }

export type IdentifierKind = 'name' | 'email' | 'student_number' | 'date_of_birth' | 'school'

export type IdentifierMatch = { kind: IdentifierKind; value: string }

/** Fields removed outright, compared case-insensitively. */
const IDENTIFYING_KEYS = new Set([
  'firstname',
  'lastname',
  'preferredname',
  'legalname',
  'fullname',
  'displayname',
  'email',
  'phone',
  'address',
  'dateofbirth',
  'dob',
  'birthdate',
  'studentnumber',
  'pen',
  'personaleducationnumber',
])

/**
 * Values never rewritten. A storage key must stay intact so the file can be
 * fetched; it is still scanned, so a key that contains a name makes the call fail closed.
 */
const OPAQUE_KEYS = new Set(['bytesBase64', 'contentType', 'fileKey'])
/** Values never scanned: binary data only. */
const UNSCANNED_KEYS = new Set(['bytesBase64'])

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
/** "PEN: 123456789", "Student number 4471-22". Group 3 is the identifier; it must contain a digit. */
const LABELLED_ID_RE = /\b(PEN|student\s*(?:no|number|id))\b(\s*[:#.]\s*|\s+)((?=[A-Za-z-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,})/giu
/** "Date of birth: 2016-03-02", "DOB 03/02/2016", "Birthdate: March 2, 2016". Group 3 is the date. */
const LABELLED_DOB_RE =
  /\b(date\s+of\s+birth|DOB|birth\s*date)\b(\s*[:-]?\s*)(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\p{L}+\.?\s+\d{1,2},?\s+\d{4})/giu

const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (literal: string, flags = 'giu') =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(literal)}(?![\\p{L}\\p{N}_])`, flags)

type Rule = { literal: string; token: string; kind: IdentifierKind }

class TokenBook {
  readonly map: DeidMap = { tokens: {} }
  private byValue = new Map<string, string>()
  private counters: Record<string, number> = {}

  /** Same original text (case-insensitive) always gets the same token. */
  tokenFor(prefix: string, original: string): string {
    const key = `${prefix}|${stripAccents(original).toLowerCase()}`
    const existing = this.byValue.get(key)
    if (existing) return existing
    this.counters[prefix] = (this.counters[prefix] ?? 0) + 1
    const token = `[${prefix}-${this.counters[prefix]}]`
    this.byValue.set(key, token)
    this.map.tokens[token] = original
    return token
  }

  /** A fixed token, e.g. the student's display token. */
  fixed(token: string, original: string) {
    if (!(token in this.map.tokens)) this.map.tokens[token] = original
    return token
  }
}

const variants = (s: string): string[] => {
  const t = s.normalize('NFC').trim()
  return t.length < 2 ? [] : [...new Set([t, stripAccents(t)])]
}

function rosterRules(roster: Roster, book: TokenBook): { early: Rule[]; names: Rule[] } {
  const early: Rule[] = []
  const names: Rule[] = []
  const seen = new Set<string>()
  const addName = (literal: string, token: string, kind: IdentifierKind = 'name') => {
    for (const v of variants(literal)) {
      const key = v.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push({ literal: v, token, kind })
    }
  }
  const addEarly = (literal: string | null | undefined, prefix: string, kind: IdentifierKind) => {
    if (!literal || literal.trim().length < 2) return
    early.push({ literal: literal.trim(), token: book.tokenFor(prefix, literal.trim()), kind })
  }

  for (const s of roster.students) {
    const shown = s.preferredName || s.firstName
    const token = book.fixed(s.token, shown)
    addEarly(s.email, 'EMAIL', 'email')
    addEarly(s.studentNumber, 'ID', 'student_number')
    addEarly(s.dateOfBirth, 'DOB', 'date_of_birth')
    addName(`${s.firstName} ${s.lastName}`, token)
    if (s.preferredName) addName(`${s.preferredName} ${s.lastName}`, token)
    addName(s.firstName, token)
    if (s.preferredName) addName(s.preferredName, token)
    addName(s.lastName, book.tokenFor('NAME', s.lastName))
  }
  for (const p of roster.people) {
    addEarly(p.email, 'EMAIL', 'email')
    addName(p.displayName, book.tokenFor('PERSON', p.displayName))
    for (const part of p.displayName.split(/\s+/)) {
      if (part.length >= 2) addName(part, book.tokenFor('NAME', part))
    }
  }
  for (const school of roster.schools) {
    const token = book.tokenFor('SCHOOL', school)
    addName(school, token, 'school')
    const core = school.replace(/\s*\([^)]*\)\s*$/, '')
    if (core !== school) addName(core, token, 'school')
  }
  // Longest first, so "Kai Nakamura" is replaced before "Kai".
  names.sort((a, b) => b.literal.length - a.literal.length)
  return { early, names }
}

function replaceText(text: string, early: Rule[], names: Rule[], book: TokenBook): string {
  let out = text.normalize('NFC')
  for (const r of early) out = out.split(r.literal).join(r.token)
  out = out.replace(EMAIL_RE, (m) => book.tokenFor('EMAIL', m))
  out = out.replace(LABELLED_ID_RE, (_m, label: string, sep: string, id: string) => `${label}${sep}${book.tokenFor('ID', id)}`)
  out = out.replace(LABELLED_DOB_RE, (_m, label: string, sep: string, dob: string) => `${label}${sep}${book.tokenFor('DOB', dob)}`)
  for (const r of names) out = out.replace(wordRe(r.literal), r.token)
  return out
}

function walk(value: unknown, onString: (s: string) => string, dropKeys: boolean, skipKeys: Set<string>): unknown {
  if (typeof value === 'string') return onString(value)
  if (Array.isArray(value)) return value.map((v) => walk(v, onString, dropKeys, skipKeys))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (dropKeys && IDENTIFYING_KEYS.has(k.toLowerCase())) continue
      out[k] = skipKeys.has(k) ? v : walk(v, onString, dropKeys, skipKeys)
    }
    return out
  }
  return value
}

/**
 * Replaces names, emails, student numbers, dates of birth and school names
 * with stable tokens, and drops identifying fields (firstName, email, dob ...).
 * The returned value has the same shape as the input minus those fields.
 */
export function deidentify<T>(input: T, roster: Roster): { value: T; map: DeidMap } {
  const book = new TokenBook()
  const { early, names } = rosterRules(roster, book)
  const value = walk(input, (s) => replaceText(s, early, names, book), true, OPAQUE_KEYS) as T
  return { value, map: book.map }
}

/** Restores the original text for every token in the output. */
export function reidentify<T>(output: T, map: DeidMap): T {
  const tokens = Object.keys(map.tokens).sort((a, b) => b.length - a.length)
  const res = tokens.map((t) => ({ re: wordRe(t, 'gu'), original: map.tokens[t] }))
  return walk(output, (s) => res.reduce((acc, r) => acc.replace(r.re, () => r.original), s), false, OPAQUE_KEYS) as T
}

/** Every roster identifier, generic email, labelled id and labelled date of birth found in the text. */
export function findIdentifiers(text: string, roster: Roster): IdentifierMatch[] {
  const { early, names } = rosterRules(roster, new TokenBook())
  const found: IdentifierMatch[] = []
  const t = text.normalize('NFC')
  for (const r of early) if (t.includes(r.literal)) found.push({ kind: r.kind, value: r.literal })
  for (const m of t.matchAll(EMAIL_RE)) found.push({ kind: 'email', value: m[0] })
  for (const m of t.matchAll(LABELLED_ID_RE)) found.push({ kind: 'student_number', value: m[3] })
  for (const m of t.matchAll(LABELLED_DOB_RE)) found.push({ kind: 'date_of_birth', value: m[3] })
  for (const r of names) {
    const m = t.match(wordRe(r.literal, 'iu'))
    if (m) found.push({ kind: r.kind, value: m[0] })
  }
  return found
}

/** Every string in a value except binary data, for the leak scan. */
export function collectStrings(value: unknown): string[] {
  const out: string[] = []
  walk(value, (s) => (out.push(s), s), false, UNSCANNED_KEYS)
  return out
}
