import { appFiles, workerErrorHandler } from 'deepspace/worker'
import type { Env } from '../../../../worker'
import { resolveAuth } from '../../http-routes'
import { getProvider } from '../ai/provider'
import { summaryProviderFromEnv } from '../ai/summaries-provider'
import { DISTRICT, SCHOOL } from '../fixtures/school'
import { altamyraDistrictId, altamyraSchoolId, insightsRoom, openStudentLive, schoolRoom, studentRoom } from '../rooms/stubs'
import type { AltamyraRouteDeps } from './deps'

/** Production wiring for the /api/v1 routes (Durable Object rooms, DeepSpace auth and files). */
export const productionDeps: AltamyraRouteDeps = {
  rooms: {
    student: (env, studentId) => studentRoom(env, studentId),
    school: (env) => schoolRoom(env),
    insights: (env) => insightsRoom(env),
  },
  resolveUserId: async (req, env) => (await resolveAuth(req, env))?.userId ?? null,
  aiProvider: (env, teacher) => getProvider(env, teacher),
  summaryProvider: (env) => summaryProviderFromEnv(env),
  // Real names come from the rooms per request (Req.ai). Assumption: this single-school deployment serves the
  // fixture school until a school-name record exists, so its school and district names are the base roster.
  roster: () => ({ students: [], people: [], schools: [SCHOOL.name, DISTRICT.name] }),
  schoolId: (env) => altamyraSchoolId(env),
  districtId: (env) => altamyraDistrictId(env),
  devSeedEnabled: (env) => (env as Env & { ALTAMYRA_DEV_SEED?: string }).ALTAMYRA_DEV_SEED === 'true',
  deleteFile: async (env, fileKey, ownerUserId) => {
    await appFiles(env, { scope: 'self', userId: ownerUserId }).delete(fileKey)
  },
  openLive: (env, studentId, request) => openStudentLive(env, studentId, request),
  fallbackError: workerErrorHandler('error'),
  now: () => Date.now(),
}
