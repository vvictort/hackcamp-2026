import { appFiles, workerErrorHandler } from 'deepspace/worker'
import type { Env } from '../../../../worker'
import { getProvider } from '../ai/provider'
import { DISTRICT, SCHOOL } from '../fixtures/school'
import { defaultAuthDeps } from '../middleware'
import { altamyraDistrictId, altamyraSchoolId, insightsRoom, openStudentLive, schoolRoom, studentRoom } from '../rooms/stubs'
import { sheetCodeFromFileKey, type AltamyraRouteDeps } from './deps'

/** Production wiring for the /api/v1 routes (Durable Object rooms, DeepSpace auth and files). */
export const productionDeps: AltamyraRouteDeps = {
  rooms: {
    student: (env, studentId) => studentRoom(env, studentId),
    school: (env) => schoolRoom(env),
    insights: (env) => insightsRoom(env),
  },
  resolveUserId: defaultAuthDeps.resolveUserId,
  aiProvider: (env) => getProvider(env),
  // Real names come from the rooms per request (Req.ai). Assumption: this single-school deployment serves the
  // fixture school until a school-name record exists, so its school and district names are the base roster.
  roster: () => ({ students: [], people: [], schools: [SCHOOL.name, DISTRICT.name] }),
  schoolId: (env) => altamyraSchoolId(env),
  districtId: (env) => altamyraDistrictId(env),
  devSeedEnabled: (env) => (env as Env & { ALTAMYRA_DEV_SEED?: string }).ALTAMYRA_DEV_SEED === 'true',
  deleteFile: async (env, fileKey, ownerUserId) => {
    await appFiles(env, { scope: 'self', userId: ownerUserId }).delete(fileKey)
  },
  readSheetCode: sheetCodeFromFileKey,
  openLive: (env, studentId, request) => openStudentLive(env, studentId, request),
  fallbackError: workerErrorHandler('error'),
  now: () => Date.now(),
}
