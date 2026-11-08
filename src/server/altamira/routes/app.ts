import { Hono } from 'hono'
import { altamiraOnError, type AltamiraEnv } from '../middleware/auth'
import { captureRoutes } from './capture'
import { createKit } from './context'
import { demoDayRoutes } from './demo-day'
import type { AltamiraRouteDeps } from './deps'
import { familyRoutes } from './family'
import { lensUsageRoutes } from './lens-usage'
import { lessonPlanRoutes } from './lesson-plans'
import { meRoutes } from './me'
import { progressRoutes } from './progress'
import { studentRoutes } from './students'
import { ticketRoutes } from './tickets'

/** Answers anything that is not an Altamira error with a generic 500 and no details. */
const genericError = () => new Response(JSON.stringify({ error: { code: 'internal', message: 'Internal error' } }), {
  status: 500,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * The /api/v1 sub-app (design doc "API routes"). It has no Workers imports,
 * so tests build it with in-memory rooms; routes/index.ts adds the production deps.
 */
export function createAltamiraApi(deps: AltamiraRouteDeps, options: { internal?: boolean } = {}): Hono<AltamiraEnv> {
  const api = new Hono<AltamiraEnv>()
  const kit = createKit(deps)
  meRoutes(api, kit)
  // The demo day drives a second copy of this app (without this route) as each role in turn.
  if (!options.internal) demoDayRoutes(api, kit, (innerDeps) => createAltamiraApi(innerDeps, { internal: true }))
  studentRoutes(api, kit)
  lensUsageRoutes(api, kit)
  lessonPlanRoutes(api, kit)
  ticketRoutes(api, kit)
  captureRoutes(api, kit)
  progressRoutes(api, kit)
  familyRoutes(api, kit)
  // A registered catch-all (not notFound, which a mounted sub-app does not carry) keeps unknown
  // /api/v1 paths from falling through to the SPA fallback.
  api.all('*', () =>
    new Response(JSON.stringify({ error: { code: 'not_found', message: 'Unknown Altamira route' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  api.onError(altamiraOnError(deps.fallbackError ?? genericError))
  return api
}
