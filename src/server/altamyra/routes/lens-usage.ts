import type { Hono } from 'hono'
import { z } from 'zod'
import { AdaptationType } from '../contract/enums'
import { Id } from '../contract/common'
import type { AltamyraEnv } from '../middleware/auth'
import { lensUsageList } from '../services/lens'
import type { Kit } from './context'

export const LensUsageResponse = z.object({
  events: z.array(
    z.object({
      suggestionId: Id,
      at: z.string(),
      label: z.enum(['adaptation', 'modification']).nullable(),
      adaptationType: AdaptationType.nullable(),
      title: z.string(),
      text: z.string(),
      goalIds: z.array(Id),
    }),
  ),
  used: z.array(z.object({ adaptationType: AdaptationType, n: z.number().int() })),
})

export function lensUsageRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, req } = kit

  app.get('/students/:id/lens-usage', signedIn, mw.requireCapability('progress.view'), async (c) => {
    const r = req(c)
    return r.json(LensUsageResponse, await r.student(r.param('id'), lensUsageList))
  })
}
