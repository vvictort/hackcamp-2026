import { Hono } from 'hono'
import { altamyraOnError, type AltamyraEnv } from '../middleware/auth'
import { jsonResponse } from '../middleware/errors'
import { captureRoutes } from './capture'
import { createKit } from './context'
import { daysRoutes } from './days'
import { demoDayRoutes } from './demo-day'
import type { AltamyraRouteDeps } from './deps'
import { familyRoutes } from './family'
import { lensUsageRoutes } from './lens-usage'
import { lessonPlanRoutes } from './lesson-plans'
import { meRoutes } from './me'
import { progressRoutes } from './progress'
import { studentRoutes } from './students'
import { summariesRoutes } from './summaries'
import { ticketRoutes } from './tickets'

/**
 * The /api/v1 sub-app (design doc "API routes"). It has no Workers imports,
 * so tests build it with in-memory rooms; routes/index.ts adds the production deps.
 */
export function createAltamyraApi(deps: AltamyraRouteDeps): Hono<AltamyraEnv> {
  const api = new Hono<AltamyraEnv>()
  const kit = createKit(deps)
  meRoutes(api, kit)
  demoDayRoutes(api, kit, createAltamyraApi)
  studentRoutes(api, kit)
  lensUsageRoutes(api, kit)
  lessonPlanRoutes(api, kit)
  ticketRoutes(api, kit)
  daysRoutes(api, kit)
  captureRoutes(api, kit)
  progressRoutes(api, kit)
  summariesRoutes(api, kit)
  familyRoutes(api, kit)
  // A registered catch-all (not notFound, which a mounted sub-app does not carry) keeps unknown
  // /api/v1 paths from falling through to the SPA fallback.
  api.all('*', () => jsonResponse({ error: { code: 'not_found', message: 'Unknown Altamyra route' } }, 404))
  api.onError(altamyraOnError(deps.fallbackError))
  return api
}
