import type { Hono } from 'hono'
import { z } from 'zod'
import { InsightsResponse } from '../contract/api'
import { INSIGHT_DIMENSIONS, InsightDimension, MIN_GROUP_SIZE } from '../contract/insights'
import type { AltamyraEnv } from '../middleware/auth'
import { insightsGet } from '../services/insights'
import type { Kit } from './context'

const InsightsTrendsResponse = InsightsResponse.extend({
  districtId: z.string(),
  minGroupSize: z.number().int(),
  groupBy: z.array(InsightDimension),
})

/** GET /insights: the signed-in district lead's aggregates; groups under the minimum size come back suppressed. */
export function insightsRoutes(app: Hono<AltamyraEnv>, kit: Kit): void {
  const { mw, signedIn, req, deps } = kit

  app.get(
    '/insights',
    signedIn,
    mw.requireCapability('insights.view', 'none', (c) => ({ districtId: deps.districtId(c.env) })),
    async (c) => {
      const r = req(c)
      const districtId = deps.districtId(r.env)
      const raw = c.req.queries('groupBy')?.flatMap((g) => g.split(',')).filter(Boolean)
      const groupBy = raw?.length ? raw : ['schoolId', 'goalArea']
      const parsed = r.query(z.object({ period: z.string().optional(), groupBy: z.array(InsightDimension).min(1) }), {
        period: c.req.query('period'),
        groupBy,
      })
      const { groups, monthlyNarrative } = await r.insights(insightsGet, { districtId, ...parsed })
      return r.json(InsightsTrendsResponse, { groups, monthlyNarrative, districtId, minGroupSize: MIN_GROUP_SIZE, groupBy: INSIGHT_DIMENSIONS.filter((d) => parsed.groupBy.includes(d)) })
    },
  )
}
