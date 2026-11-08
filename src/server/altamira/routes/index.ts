import type { Hono } from 'hono'
import type { AppContext } from '../../../../worker'
import type { AltamiraEnv } from '../middleware/auth'
import { createAltamiraApi } from './app'
import { productionDeps } from './defaults'
import type { AltamiraRouteDeps } from './deps'

export { createAltamiraApi } from './app'
export type { AltamiraRouteDeps } from './deps'

/** Mounts every Altamira route under /api/v1. Tests pass overrides; production uses the defaults. */
export function registerAltamiraRoutes(app: Hono<AppContext>, overrides: Partial<AltamiraRouteDeps> = {}): void {
  const api = createAltamiraApi({ ...productionDeps, ...overrides })
  // AltamiraEnv only adds request variables to the worker's bindings.
  app.route('/api/v1', api as unknown as Hono<AppContext & AltamiraEnv>)
}
