import { Hono } from 'hono'
import type { AppContext } from '../../../../worker'
import { altamiraOnError, type AltamiraEnv } from '../middleware/auth'
import { createAltamiraApi } from './app'
import { createKit } from './context'
import { productionDeps } from './defaults'
import type { AltamiraRouteDeps } from './deps'
import { insightsRoutes } from './insights'

export { createAltamiraApi } from './app'
export type { AltamiraRouteDeps } from './deps'
export { insightsRoutes } from './insights'

/** Mounts every Altamira route under /api/v1. Tests pass overrides; production uses the defaults. */
export function registerAltamiraRoutes(app: Hono<AppContext>, overrides: Partial<AltamiraRouteDeps> = {}): void {
  const deps = { ...productionDeps, ...overrides }
  // Mounted before the main api so its catch-all 404 does not shadow /insights.
  const extra = new Hono<AltamiraEnv>()
  insightsRoutes(extra, createKit(deps))
  extra.onError(altamiraOnError(deps.fallbackError ?? (() => new Response(JSON.stringify({ error: { code: 'internal', message: 'Internal error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } }))))
  // AltamiraEnv only adds request variables to the worker's bindings.
  app.route('/api/v1', extra as unknown as Hono<AppContext & AltamiraEnv>)
  app.route('/api/v1', createAltamiraApi(deps) as unknown as Hono<AppContext & AltamiraEnv>)
}
