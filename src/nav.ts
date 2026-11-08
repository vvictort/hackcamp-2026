/**
 * Routed navigation entries. Navigation.tsx renders these (filtered by role
 * and devOnly), giving each an icon from its ICONS map, with a fallback for
 * entries `deepspace add` inserts below the marker line. The same `roles`
 * also guard the pages (see RoleGate), so a role never reaches a screen its
 * nav does not offer.
 */

import type { AltamiraRole } from '@/lib/altamira/role'
import type { MessageKey } from '@/i18n/en'

export interface NavItem {
  path: string
  /** i18n key, translated at render. */
  label: MessageKey
  /** Altamira roles that may use the item; omitted = everyone. */
  roles?: AltamiraRole[]
  devOnly?: boolean
  /** Reachable by URL and from other pages, but not shown in the sidebar. */
  hidden?: boolean
  /** Also shown to roles outside `roles` while the demo role switcher is on (Home hosts the switcher). */
  showInDemo?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'nav.home', roles: ['ea', 'teacher', 'case_manager'], showInDemo: true },
  { path: '/students', label: 'app.nav.students', roles: ['ea', 'teacher', 'case_manager'] },
  { path: '/lesson-lens', label: 'app.nav.lessonLens', roles: ['teacher'] },
  { path: '/capture', label: 'app.nav.capture', roles: ['ea', 'teacher'] },
  { path: '/review', label: 'app.nav.review', roles: ['ea', 'teacher'] },
  { path: '/ea', label: 'app.nav.ea', roles: ['ea'], hidden: true },
  { path: '/family', label: 'app.nav.family', roles: ['parent'] },
  { path: '/insights', label: 'app.nav.insights', roles: ['district_lead'] },
  { path: '/admin/roles', label: 'app.nav.roles', roles: ['school_admin'] },
  { path: '/settings', label: 'nav.settings' },
  // The /api-status debug page still exists: add
  // `{ path: '/api-status', label: 'app.nav.apiStatus', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]

/** Roles allowed on a route, or undefined when everyone is. */
export function rolesForPath(path: string): AltamiraRole[] | undefined {
  return nav.find((n) => n.path === path)?.roles
}
