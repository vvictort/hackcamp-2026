import { Hono } from 'hono'
import type { AppContext } from '../../../../worker'
import { altamyraOnError, type AltamyraEnv } from '../middleware/auth'
import { createAltamyraApi } from './app'
import { createKit } from './context'
import { productionDeps } from './defaults'
import type { AltamyraRouteDeps } from './deps'
import { insightsRoutes } from './insights'

export { createAltamyraApi } from './app'
export type { AltamyraRouteDeps } from './deps'
export { insightsRoutes } from './insights'

/** Mounts every Altamyra route under /api/v1. Tests pass overrides; production uses the defaults. */
export function registerAltamyraRoutes(app: Hono<AppContext>, overrides: Partial<AltamyraRouteDeps> = {}): void {
  const deps = { ...productionDeps, ...overrides }
  // Mounted before the main api so its catch-all 404 does not shadow /insights.
  const extra = new Hono<AltamyraEnv>()
  insightsRoutes(extra, createKit(deps))
  extra.onError(altamyraOnError(deps.fallbackError ?? (() => new Response(JSON.stringify({ error: { code: 'internal', message: 'Internal error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } }))))
  // AltamyraEnv only adds request variables to the worker's bindings.
  app.route('/api/v1', extra as unknown as Hono<AppContext & AltamyraEnv>)
  app.route('/api/v1', createAltamyraApi(deps) as unknown as Hono<AppContext & AltamyraEnv>)
}
