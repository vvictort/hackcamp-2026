import type { MessageKey } from '@/i18n/en'

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

/** Display-label i18n key per stored value; the stored value itself stays English. */
export const POSITION_LABELS: Record<Position, MessageKey> = {
  'Classroom teacher': 'app.position.classroomTeacher',
  'Resource / case-manager teacher': 'app.position.resourceTeacher',
  'Education assistant': 'app.position.educationAssistant',
  'Substitute teacher': 'app.position.substituteTeacher',
  Administrator: 'app.position.administrator',
  'District inclusive-education lead': 'app.position.districtLead',
}
