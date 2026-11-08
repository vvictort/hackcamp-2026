import type { z } from 'zod'

export const issuesOf = (error: z.ZodError, root = '(root)'): string[] =>
  error.issues.map((i) => `${i.path.map(String).join('.') || root}: ${i.message}`)
