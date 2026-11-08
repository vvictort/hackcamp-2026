import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppContext, Env } from '../../worker.js'
import { registerRealtimeRoutes } from './realtime-routes.js'

describe('generic /ws/:roomId', () => {
  const app = new Hono<AppContext>()
  registerRealtimeRoutes(app)

  it('refuses Altamira room ids before reaching any Durable Object', async () => {
    // No bindings: a request that got past the guard would throw on env.RECORD_ROOMS.
    const env = {} as Env
    for (const id of ['student:57d00000-0000-4000-8000-00000000000a', 'school:x', 'district:y', 'student%3Ax']) {
      const res = await app.request(`/ws/${id}`, {}, env)
      expect(res.status).toBe(403)
    }
  })
})
