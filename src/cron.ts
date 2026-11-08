/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO itself records executions, tracks history, and
 * pushes status to admin clients via the `/ws/cron/:roomId` WebSocket.
 *
 * Each task declares EITHER `intervalMinutes` (run every N minutes) OR
 * `schedule` + `timezone` (5-field cron expression). CronRoom validates
 * the config at construction time and throws on ambiguous declarations.
 *
 * Example:
 *
 *   import type { CronTask } from 'deepspace/worker'
 *   import { buildCronContext } from 'deepspace/worker'
 *
 *   export const tasks: CronTask[] = [
 *     { name: 'heartbeat', intervalMinutes: 1 },
 *     { name: 'daily-report', schedule: '0 9 * * *', timezone: 'America/New_York' },
 *   ]
 *
 *   export async function runTask(name: string, env: Env): Promise<void> {
 *     const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
 *     if (name === 'heartbeat') {
 *       // …
 *     }
 *   }
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { ALTAMYRA_CRON, runAltamyraCronTask } from './server/altamyra/rooms/jobs-core.js'
import { jobDeps } from './server/altamyra/rooms/job-deps.js'

// Altamyra (design doc "Jobs"). BC schools, so school-day local time.
const SCHOOL_TZ = 'America/Vancouver'

export const tasks: CronTask[] = [
  { name: ALTAMYRA_CRON.dataNeeded, schedule: '0 6 * * *', timezone: SCHOOL_TZ },
]

export async function runTask(name: string, env: Env): Promise<void> {
  await runAltamyraCronTask(name, jobDeps(env))
}
