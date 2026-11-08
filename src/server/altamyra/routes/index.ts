import type { Hono } from 'hono'
import type { AppContext } from '../../../../worker'
import type { AltamyraEnv } from '../middleware/auth'
import { createAltamyraApi } from './app'
import { productionDeps } from './defaults'

export function registerAltamyraRoutes(app: Hono<AppContext>): void {
  app.route('/api/v1', createAltamyraApi(productionDeps) as unknown as Hono<AppContext & AltamyraEnv>)
}
