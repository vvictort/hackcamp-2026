/**
 * The English source strings: the ONLY text the translator ever sees. The
 * server translates this object, nothing else, so no user or record data can
 * reach the model. Keys are `area.name`. Use {name} placeholders for values
 * (filled in by t(), never sent for translation).
 *
 * Add a string here, then use t('key') where it is shown.
 */
export const en = {
  'common.signIn': 'Sign in',
  'common.signOut': 'Sign out',
  'common.getStarted': 'Get started',
  'common.save': 'Save changes',
  'common.language': 'Language',
  'settings.title': 'Settings',
  'settings.language.hint': 'Choose the language you want to read the app in.',
  'dashboard.greeting': 'Good morning, {name}.',
  'nav.home': 'Home',
  'nav.settings': 'Settings',
} as const

export type MessageKey = keyof typeof en
