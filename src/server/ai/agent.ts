/**
 * Routes for the local assistant: the user's Codex, Claude, or similar client.
 *
 * The CLI only bridges a local assistant to these Worker routes. It does not
 * authorize or host the assistant.
 */

import type { Hono } from 'hono'
import { registerAgentToolRoutes, resolveAppMembership } from 'deepspace/worker'
import type { AgentToolAccessResult, AgentToolRouteOptions } from 'deepspace/worker'
import { resolveAgentAuth, resolveAuth } from '../http-routes.js'
import type { AppContext, Env } from '../../../worker.js'

/**
 * `buildTools` from src/server/ai/tools.ts. Its first argument runs record tools as
 * the caller and returns whole results; each tool's own result is capped for
 * the model where the SDK hands it over. Tools that need the Worker's
 * bindings take the second: the request's `env`, the verified `userId`, and
 * the `request` (store files with `appFiles(context.env, ...)`).
 */
type ToolFactory = AgentToolRouteOptions<Env>['buildTools']

function createAccessResolver(resolveIdentity: typeof resolveAuth) {
  return async (request: Request, env: Env): Promise<AgentToolAccessResult> => {
    const auth = await resolveIdentity(request, env)
    if (!auth) return { ok: false, status: 401 }

    // Membership has exactly one definition — the caller's row in the users
    // collection of the app's room (the owner is always a member); a
    // signed-in app visit creates it. It is the same primitive that gates the
    // admin and realtime routes. A membership read that could not complete is
    // 503 (retryable), never 403: a transient room failure must not present
    // as a permission denial.
    const membership = await resolveAppMembership(env, auth.userId, request.signal)
    if (!membership) return { ok: false, status: 503 }
    if (!membership.member) return { ok: false, status: 403 }

    return { ok: true, auth }
  }
}

export function registerAgent(app: Hono<AppContext>, tools: ToolFactory): void {
  registerAgentToolRoutes(app, {
    buildTools: tools,
    resolveAccess: createAccessResolver(resolveAgentAuth),
    resolveBrowserAccess: createAccessResolver(resolveAuth),
  })
}
