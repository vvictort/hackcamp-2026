import { appFiles, workerErrorHandler } from 'deepspace/worker'
import type { Env } from '../../../../worker'
import { fixtureRoster } from '../ai/fixture-data'
import { getProvider } from '../ai/provider'
import { defaultAuthDeps } from '../middleware'
import { altamiraDistrictId, altamiraSchoolId, insightsRoom, openStudentLive, schoolRoom, studentRoom } from '../rooms/stubs'
import { sheetCodeFromFileKey, type AltamiraRouteDeps } from './deps'

/** Production wiring for the /api/v1 routes (Durable Object rooms, DeepSpace auth and files). */
export const productionDeps: AltamiraRouteDeps = {
  rooms: {
    student: (env, studentId) => studentRoom(env, studentId),
    school: (env) => schoolRoom(env),
    insights: (env) => insightsRoom(env),
  },
  resolveUserId: defaultAuthDeps.resolveUserId,
  aiProvider: (env) => getProvider(env),
  // Assumption: the de-identification roster is the fictional fixture roster until a roster export exists.
  roster: () => fixtureRoster(),
  schoolId: (env) => altamiraSchoolId(env),
  districtId: (env) => altamiraDistrictId(env),
  devSeedEnabled: (env) => (env as Env & { ALTAMIRA_DEV_SEED?: string }).ALTAMIRA_DEV_SEED === 'true',
  deleteFile: async (env, fileKey, ownerUserId) => {
    await appFiles(env, { scope: 'self', userId: ownerUserId }).delete(fileKey)
  },
  readSheetCode: sheetCodeFromFileKey,
  openLive: (env, studentId, request) => openStudentLive(env, studentId, request),
  fallbackError: workerErrorHandler('error'),
  now: () => Date.now(),
}
