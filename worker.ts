/**
 * App Worker — explicit assembly for DeepSpace app routes and Durable Objects.
 *
 * Backend / frontend split:
 *   backend  = this file + src/server/** (HTTP and realtime routes, AI agent
 *              and tools, integrations, jobs) + src/cron.ts (kept at the path
 *              `deepspace add` writes to).
 *   shared   = src/schemas.ts + src/schemas/ (record schemas, read by both).
 *   frontend = everything else in src/ (pages, components, lib, styles).
 * Keep route registration order here: specific API and WebSocket handlers
 * must precede the SPA fallback.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  armCronRoom,
  CanvasRoom,
  CronRoom,
  JobRoom,
  PresenceRoom,
  RecordRoom,
  resolveAppRole,
  workerErrorHandler,
  YjsRoom,
} from 'deepspace/worker'
import type { DOBindings, DOManifest, Job, JobContext } from 'deepspace/worker'
import { registerAgent } from './src/server/ai/agent.js'
import { buildTools } from './src/server/ai/tools.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/server/jobs.js'
import { schemas } from './src/schemas.js'
import { registerI18nRoutes } from './src/server/i18n-routes.js'
import {
  registerAuthAndIntegrationRoutes,
  registerPlatformProxyRoutes,
  registerStaticRoutes,
} from './src/server/http-routes.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'
import { registerAltamyraRoutes } from './src/server/altamyra/routes/index.js'
import {
  AltamyraInsightsRoom,
  AltamyraSchoolRoom,
  AltamyraStudentRoom,
} from './src/server/altamyra/rooms/index.js'

// Altamyra Durable Objects (SQLite, ctx.storage.sql). Reached only via /api/v1.
export { AltamyraInsightsRoom, AltamyraSchoolRoom, AltamyraStudentRoom }

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
  { binding: 'STUDENT_ROOMS', className: 'AltamyraStudentRoom', sqlite: true },
  { binding: 'SCHOOL_ROOMS', className: 'AltamyraSchoolRoom', sqlite: true },
  { binding: 'INSIGHTS_ROOMS', className: 'AltamyraInsightsRoom', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

/** Runs the scheduled tasks defined in src/cron.ts. */
export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

/** Runs durable background work defined in src/server/jobs.ts. */
export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      authorizeWrite: async (user) => {
        if (user.userId.startsWith('anon-')) return false
        const role = await resolveAppRole(env, user.userId)
        return role === 'member' || role === 'admin'
      },
    })
  }

  protected async onJob(job: Job, context: JobContext): Promise<unknown> {
    return await runJob(job, context, this.env)
  }
}

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  /**
   * Platform service binding in production; deepspace dev supplies the URL
   * fallback. Standard app files use the platform's shared, app-scoped R2
   * bucket rather than a local binding.
   */
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  /**
   * HMAC app credential minted on first deploy. Proxy routes omit identity
   * headers when it is absent so upstream services fail closed.
   */
  APP_IDENTITY_TOKEN?: string
  /** API service binding in production with a deepspace-dev URL fallback. */
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  /** Comma-separated exact Expo/native callback URIs (for example, myapp://auth/callback). */
  NATIVE_AUTH_REDIRECT_URIS?: string
  APP_NAME: string
  /** Immutable record-scope and platform identity. */
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  /**
   * Long-lived owner JWT used for developer-billed server calls. User-billed
   * calls always forward the signed-in caller's JWT instead.
   */
  APP_OWNER_JWT: string
  /**
   * Enables /api/debug/* only when exactly "true". The route still requires
   * an authenticated app owner/admin. deepspace dev/test set it locally.
   */
  ALLOW_DEBUG_ROUTES?: string
  /** Altamyra: the single school room this deployment serves (defaults to the fictional fixture school). */
  ALTAMYRA_SCHOOL_ID?: string
  /** Altamyra: the district insights room (defaults to the fictional fixture district). */
  ALTAMYRA_DISTRICT_ID?: string
  /** Altamyra AI provider: "fixture" (default) or "vertex" (stub until approved). */
  ALTAMYRA_AI_PROVIDER?: string
  GEMINI_API_KEY?: string
  ALTAMYRA_GEMINI_MODELS?: string
  MARITIME_AGENT_URL?: string
  MARITIME_AGENT_TOKEN?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()
app.use('/api/*', cors())
// A Durable Object exists only once something fetches it, and the CronRoom
// arms its alarm in that first fetch — so wake it from the request path, or a
// deployed schedule waits for a visitor. Once per isolate; no-op without tasks.
app.use('*', async (c, next) => {
  armCronRoom(c.executionCtx, c.env.CRON_ROOMS, `app:${c.env.DEEPSPACE_APP_ID}`, cronTasks)
  await next()
})

// Registration order is part of the worker contract. The wildcard auth route
// follows its special cases, AI precedes platform proxies, and static is last.
registerAuthAndIntegrationRoutes(app)
registerRealtimeRoutes(app)
registerI18nRoutes(app)
registerAgent(app, buildTools)
registerPlatformProxyRoutes(app)
// Altamyra /api/v1 routes, before the SPA fallback in registerStaticRoutes.
registerAltamyraRoutes(app)
registerStaticRoutes(app)

// Hono registers ONE error handler (last onError wins), and its default is
// `console.error(err)` — whose message Workers Logs drops, keeping only the
// stack frames. workerErrorHandler logs the string form instead (message
// first, frames and bounded cause chain, method + path for context), keeps a
// response-bearing error's (HTTPException — auth 401s, upload 413s) own
// answer, and returns a generic 500 for the rest.
app.onError(workerErrorHandler('error'))

export default app
