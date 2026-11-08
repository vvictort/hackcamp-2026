import { USERS_COLUMNS, type CollectionSchema } from 'deepspace/schema'

export const usersSchema: CollectionSchema = {
  name: 'users',
  columns: [
    ...USERS_COLUMNS,
    // Profile and preferences, edited by the user on the Settings page.
    { name: 'school', storage: 'text', interpretation: 'plain', maxLength: 120 },
    { name: 'position', storage: 'text', interpretation: 'plain', maxLength: 60 },
    { name: 'language', storage: 'text', interpretation: 'plain', maxLength: 8 },
    { name: 'pulseReminder', storage: 'text', interpretation: 'plain', maxLength: 5 },
  ],
  permissions: {
    viewer: { read: 'own', create: false, update: 'own', delete: false },
    member: { read: 'own', create: false, update: 'own', delete: false },
    admin: { read: true, create: false, update: true, delete: true },
  },
}
