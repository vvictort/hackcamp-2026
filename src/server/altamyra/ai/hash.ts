/** JSON with object keys sorted, so equal values always give the same string. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Hash of any value, stable across key order. */
export const hashOf = (value: unknown): number => fnv1a(stableStringify(value))

/** Deterministic number in [0, 1) from a seed and an optional salt. */
export const unitInterval = (seed: string | number, salt = ''): number => fnv1a(`${seed}|${salt}`) / 0x100000000
