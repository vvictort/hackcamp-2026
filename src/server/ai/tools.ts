/**
 * AI Tool Definitions — converts DeepSpace BUILT_IN_TOOLS to Vercel AI SDK tools.
 *
 * The assistant can read AND modify data. Per-collection RBAC at the DO
 * layer is the actual security boundary — the user's role determines what
 * each tool call is allowed to do, regardless of what's in this allowlist.
 * Trim entries below if you want a stricter assistant for your app.
 */

import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod/v4'
import { BUILT_IN_TOOLS, applyAiToolDefaults } from 'deepspace/worker'
import type { ToolSchema } from 'deepspace/worker'

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<unknown>

const ALLOWED_TOOL_NAMES = [
  'schema.list',
  'schema.describe',
  'records.query',
  'records.get',
  'records.create',
  'records.update',
  'records.delete',
  'user.current',
]

// ============================================================================
// Tool definitions
// ============================================================================

export function buildTools(executor: ToolExecutor): ToolSet {
  const tools: ToolSet = {}

  for (const def of BUILT_IN_TOOLS) {
    if (!ALLOWED_TOOL_NAMES.includes(def.name)) continue
    const safeName = def.name.replace('.', '_')
    tools[safeName] = tool({
      description: def.description,
      inputSchema: buildInputSchema(def),
      // Apply assistant-only param defaults (e.g. records.query page size) here
      // in the AI tool layer, so internal record readers that hit the tools
      // dispatch directly stay unbounded.
      execute: async (params: Record<string, unknown>) =>
        executor(def.name, applyAiToolDefaults(def.name, params)),
    })
  }

  return tools
}

// ============================================================================
// Convert ToolSchema params → Zod validator + derived provider JSON Schema
// ============================================================================

/**
 * The Zod validator is the single source; the provider-facing JSON Schema is
 * derived from it with Zod's native conversion, which keeps z.record()
 * objects open (`additionalProperties: {}`). The AI SDK's own Zod conversion
 * closes every object, which would incorrectly advertise the free-form
 * `data` and `where` objects as empty — so the conversion happens here.
 */
function buildInputSchema(def: ToolSchema) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [name, param] of Object.entries(def.params)) {
    let s: z.ZodTypeAny
    switch (param.type) {
      case 'string':
        s = z.string()
        break
      case 'number':
        s = z.number()
        break
      case 'boolean':
        s = z.boolean()
        break
      case 'object':
        s = z.record(z.string(), z.unknown())
        break
      case 'array':
        s = z.array(z.unknown())
        break
    }
    if (param.description) s = s.describe(param.description)
    if (!param.required) s = s.optional()
    shape[name] = s
  }

  const validator = z.object(shape)
  return jsonSchema<Record<string, unknown>>(
    z.toJSONSchema(validator) as Parameters<typeof jsonSchema>[0],
    {
      validate: async (value) => {
        const result = await validator.safeParseAsync(value)
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error }
      },
    },
  )
}
