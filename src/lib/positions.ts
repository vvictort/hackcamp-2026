/** Positions a person can hold, stored as-is in `users.position` (max 60 characters). */
export const POSITIONS = [
  'Classroom teacher',
  'Resource / case-manager teacher',
  'Education assistant',
  'Substitute teacher',
  'Administrator',
  'District inclusive-education lead',
] as const

export type Position = (typeof POSITIONS)[number]
