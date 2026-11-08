import { z } from 'zod'

/**
 * Zod to the OpenAPI subset AI Studio accepts as generationConfig.responseSchema,
 * plus a schema-guided coercion of the model's JSON (obvious types only).
 */
type J = Record<string, unknown>

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'anyOf', 'nullable', 'description', 'format'])
const FORMATS = new Set(['enum', 'date-time'])

function convert(node: unknown): J {
  if (!node || typeof node !== 'object') return {}
  const n = { ...(node as J) }
  if (Array.isArray(n.oneOf)) {
    n.anyOf = n.oneOf
    delete n.oneOf
  }
  if ('const' in n) {
    n.enum = [String(n.const)]
    n.type = typeof n.const === 'number' ? 'number' : typeof n.const === 'boolean' ? 'boolean' : 'string'
    if (typeof n.const !== 'string') delete n.enum
  }
  if (Array.isArray(n.type)) {
    const types = (n.type as string[]).filter((t) => t !== 'null')
    if (types.length !== n.type.length) n.nullable = true
    n.type = types[0] ?? 'string'
  }
  if (Array.isArray(n.anyOf)) {
    const alts = (n.anyOf as J[]).filter((a) => a.type !== 'null')
    if (alts.length !== (n.anyOf as J[]).length) n.nullable = true
    if (alts.length === 1) return { ...convert({ ...alts[0], ...(n.nullable ? { nullable: true } : {}) }) }
    n.anyOf = alts.map(convert)
  }
  if (n.properties && typeof n.properties === 'object') {
    n.properties = Object.fromEntries(Object.entries(n.properties as J).map(([k, v]) => [k, convert(v)]))
  } else if (n.type === 'object') {
    // Gemini rejects an object with no properties; let it be a string-keyed free object via empty properties.
    n.properties = {}
  }
  if (n.items) n.items = convert(n.items)
  if (n.format && !FORMATS.has(String(n.format))) delete n.format
  for (const k of Object.keys(n)) if (!KEEP.has(k)) delete n[k]
  if (Array.isArray(n.required) && n.required.length === 0) delete n.required
  return n
}

const cache = new WeakMap<z.ZodType, J>()

export function toGeminiSchema(schema: z.ZodType): J {
  const hit = cache.get(schema)
  if (hit) return hit
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any', reused: 'inline', cycles: 'ref' })
  const out = convert(json)
  cache.set(schema, out)
  return out
}

/** Fixes obvious type slips against a converted schema: "3" to 3, 3 to "3", "true" to true, null on an optional key dropped, bare value into a one-item array. */
export function coerceToSchema(value: unknown, schema: J | undefined): unknown {
  if (!schema) return value
  const type = schema.type
  if (value === null) return value
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return (schema.anyOf as J[]).length ? coerceUnion(value, schema.anyOf as J[]) : value
  }
  if (type === 'array') {
    const items = schema.items as J | undefined
    const arr = Array.isArray(value) ? value : value === undefined ? value : [value]
    return Array.isArray(arr) ? arr.map((v) => coerceToSchema(v, items)) : arr
  }
  if (type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema.properties ?? {}) as Record<string, J>
    const required = new Set((schema.required as string[] | undefined) ?? [])
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as J)) {
      const ps = props[k]
      if (!ps) continue // extra key: strip
      if (v === null && !required.has(k) && !ps.nullable) continue
      out[k] = coerceToSchema(v, ps)
    }
    return out
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(/%$/, '')))) return Number(value.replace(/%$/, ''))
  } else if (type === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
  } else if (type === 'string') {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  }
  return value
}

function coerceUnion(value: unknown, alts: J[]): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // pick the alternative whose required keys all exist (discriminated unions)
    const keys = Object.keys(value)
    const best = alts.find((a) => a.type === 'object' && ((a.required as string[] | undefined) ?? []).every((r) => keys.includes(r)))
    if (best) return coerceToSchema(value, best)
  }
  return value
}
