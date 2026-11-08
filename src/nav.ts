/**
 * Routed navigation entries. Navigation.tsx renders these (filtered by role
 * and devOnly), giving each an icon from its ICONS map, with a fallback for
 * entries `deepspace add` inserts below the marker line.
 */

import type { AltamiraRole } from '@/lib/altamira/role'
import type { MessageKey } from '@/i18n/en'

export interface NavItem {
  path: string
  /** i18n key, translated at render. */
  label: MessageKey
  /** Altamira roles that see the item; omitted = everyone. */
  roles?: AltamiraRole[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'nav.home' },
  { path: '/students', label: 'app.nav.students', roles: ['case_manager', 'teacher', 'ea'] },
  { path: '/lesson-lens', label: 'app.nav.lessonLens', roles: ['teacher', 'case_manager'] },
  { path: '/capture', label: 'app.nav.capture', roles: ['teacher', 'ea', 'case_manager'] },
  { path: '/review', label: 'app.nav.review', roles: ['case_manager', 'teacher'] },
  { path: '/ea', label: 'app.nav.ea', roles: ['ea'] },
  { path: '/drafts', label: 'app.nav.progressDrafts', roles: ['case_manager'] },
  { path: '/family', label: 'app.nav.family', roles: ['parent', 'case_manager'] },
  { path: '/insights', label: 'app.nav.insights', roles: ['district_lead'] },
  { path: '/settings', label: 'nav.settings' },
  // The /api-status debug page still exists: add
  // `{ path: '/api-status', label: 'app.nav.apiStatus', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]
