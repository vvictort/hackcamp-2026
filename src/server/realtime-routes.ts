/**
 * WebSocket routing for the app's RecordRoom.
 *
 * Caller identity in query parameters and headers is never trusted. The route
 * scrubs it and forwards verified JWT identity in internal-only headers.
 */

import type { Hono } from 'hono'
import { authenticatedRoomRequest, verifyJwt } from 'deepspace/worker'
import type { VerifyResult } from 'deepspace/worker'
import type { AppContext } from '../../worker.js'
import { isAltamyraRoomId } from './altamyra/middleware/room-guard.js'

export function registerRealtimeRoutes(app: Hono<AppContext>): void {
  // Altamyra rooms (student:, school:, district:) are reachable only through
  // the /api/v1 router's auth and scope checks, never by a direct socket.
  app.get('/ws/:roomId', async (c) => {
    const id = c.req.param('roomId')
    if (isAltamyraRoomId(id)) return new Response('Forbidden', { status: 403 })
    const token = new URL(c.req.url).searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (
        await verifyJwt({ publicKey: c.env.AUTH_JWT_PUBLIC_KEY, issuer: c.env.AUTH_JWT_ISSUER }, token)
      ).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }

    const stub = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(id))
    return stub.fetch(authenticatedRoomRequest(c.req.raw, auth))
  })
}
