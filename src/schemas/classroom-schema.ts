/**
 * Classroom collections behind the teacher dashboard. Each row belongs to the
 * teacher who created it (`ownerId`), and a teacher reads and edits only their
 * own rows; admins can read everything. Lists inside a row (goals, student
 * ids) are stored as JSON text. Seeded with fictional example students from
 * src/lib/classroom.ts until real data is approved.
 */

import type { CollectionSchema, ColumnDefinition } from 'deepspace/schema'

const text = (name: string, maxLength = 200): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain', maxLength })
const num = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain' })

function owned(name: string, columns: ColumnDefinition[]): CollectionSchema {
  return {
    name,
    columns: [text('ownerId', 64), ...columns],
    permissions: {
      viewer: { read: 'own', create: true, update: 'own', delete: 'own' },
      member: { read: 'own', create: true, update: 'own', delete: 'own' },
      admin: { read: true, create: true, update: true, delete: true },
    },
  }
}

export const classroomSchemas: CollectionSchema[] = [
  owned('students', [text('key', 40), text('name', 80), text('firstName', 40), text('profile', 200), text('modified', 3), text('goals', 4000)]),
  owned('classBlocks', [num('sort'), text('time', 12), text('subject', 80), text('lesson', 200), text('studentIds', 400), text('status', 12), num('suggestions')]),
  owned('suggestions', [text('studentKey', 40), text('goalId', 40), text('lesson', 80), text('kind', 16), text('text', 600), text('why', 600), text('state', 16)]),
  owned('drafts', [text('studentKey', 40), text('report', 80), text('due', 40), num('linked'), num('sentences')]),
  owned('events', [num('sort'), text('day', 8), text('date', 16), text('label', 120)]),
  owned('pulse', [num('done'), num('goal')]),
]
