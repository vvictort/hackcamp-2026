import { students } from '@/i18n/en/students'

export type SKey = keyof typeof students

/**
 * Local translator for the students.* strings. Registration in en.ts is a later
 * step, so this reads the dictionary directly (English fallback for every language).
 */
export function s(key: SKey, vars?: Record<string, string | number>): string {
  const text: string = students[key]
  return vars ? text.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m)) : text
}

export const fmtDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '')
export const lines = (v: string): string[] => v.split('\n').map((x) => x.trim()).filter(Boolean)
