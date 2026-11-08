import { USERS } from './school'
import { STUDENT_FIXTURES } from './students'

export * from './school'
export * from './students'
export * from './cbiep-sample'
export * from './seed'
export * from './demo'

/**
 * Every fictional person name in the fixtures. The de-identification scan
 * (design doc "AI module") checks that none of these reach a model request or log.
 */
const names = [
  ...STUDENT_FIXTURES.flatMap((s) => [s.iep.sections.student.firstName, s.iep.sections.student.lastName]),
  ...USERS.flatMap((u) => u.displayName.split(' ')),
]
const withoutAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

export const FIXTURE_NAMES: string[] = [...new Set([...names, ...names.map(withoutAccents)])]
export * from './demo-iep-sd23'
export * from './demo-day'
