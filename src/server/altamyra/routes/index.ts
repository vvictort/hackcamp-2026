import type { Hono } from 'hono'
import type { AppContext } from '../../../../worker'
import type { AltamyraEnv } from '../middleware/auth'
import { createAltamyraApi } from './app'
import { productionDeps } from './defaults'
import type { AltamyraRouteDeps } from './deps'

export { createAltamyraApi } from './app'
export type { AltamyraRouteDeps } from './deps'

/** Mounts every Altamyra route under /api/v1. Tests pass overrides; production uses the defaults. */
export function registerAltamyraRoutes(app: Hono<AppContext>, overrides: Partial<AltamyraRouteDeps> = {}): void {
  const deps = { ...productionDeps, ...overrides }
  // AltamyraEnv only adds request variables to the worker's bindings.
  app.route('/api/v1', createAltamyraApi(deps) as unknown as Hono<AppContext & AltamyraEnv>)
}
