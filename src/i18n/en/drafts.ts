/** Family page and read-aloud strings (the Progress Drafts feature is gone; the file name is kept for the i18n module list). */
export const drafts = {
  'readAloud.play': 'Read aloud',
  'readAloud.loading': 'Preparing audio',
  'readAloud.stop': 'Stop audio',
  'readAloud.unavailable': 'Audio is not available on this device.',
  'drafts.family.title': 'Family',
  'drafts.family.description': 'Your child’s approved progress update and your sharing choices.',
  'drafts.family.student': 'Student',
  'drafts.family.none': 'No students linked to this account',
  'drafts.family.noneHint': 'Ask the school to link your child to your account.',
  'drafts.family.consents': 'Sharing choices',
  'drafts.family.consentsHint': 'Turn a choice off to stop that use. Your choice applies right away.',
  'drafts.family.consent.voice_note': 'Voice notes',
  'drafts.family.consent.voice_note.hint': 'Allow staff to record short voice notes about your child.',
  'drafts.family.consent.video': 'Videos',
  'drafts.family.consent.video.hint': 'Allow staff to record short videos of your child’s work.',
  'drafts.family.consentOn': 'Allowed',
  'drafts.family.consentOff': 'Not allowed',
  'drafts.family.consentUnknown': 'Not set yet',
  'drafts.family.consentFailed': 'Could not update this choice.',
  'drafts.family.loading': 'Loading',
  'drafts.family.loadFailed': 'Could not load this page.',
} as const

export type DraftsKey = keyof typeof drafts
