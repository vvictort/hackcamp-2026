/**
 * Routed navigation entries. Navigation.tsx renders these (filtered by role),
 * giving each an icon from its ICONS map, with a fallback for
 * entries `deepspace add` inserts below the marker line. The same `roles`
 * also guard the pages (see RoleGate), so a role never reaches a screen its
 * nav does not offer.
 */

import type { AltamyraRole } from '@/lib/altamyra/role'
import type { MessageKey } from '@/i18n/en'

export interface NavItem {
  path: string
  /** i18n key, translated at render. */
  label: MessageKey
  /** Altamyra roles that may use the item; omitted = everyone. */
  roles?: AltamyraRole[]
  /** Reachable by URL and from other pages, but not shown in the sidebar. */
  hidden?: boolean
  /** Also shown to roles outside `roles` while the demo role switcher is on (Home hosts the switcher). */
  showInDemo?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'nav.home', roles: ['ea', 'teacher', 'case_manager'], showInDemo: true },
  { path: '/students', label: 'app.nav.students', roles: ['ea', 'teacher', 'case_manager'] },
  { path: '/capture', label: 'app.nav.capture', roles: ['ea', 'teacher'] },
  { path: '/progress', label: 'app.nav.progress', roles: ['ea', 'teacher', 'case_manager'] },
  { path: '/summaries', label: 'app.nav.summaries', roles: ['ea', 'teacher', 'case_manager'] },
  { path: '/end-of-day', label: 'app.nav.endOfDay', roles: ['ea', 'teacher'], hidden: true },
  { path: '/family', label: 'app.nav.family', roles: ['parent'] },
  { path: '/insights', label: 'app.nav.insights', roles: ['district_lead'] },
  { path: '/admin/tickets', label: 'app.nav.tickets', roles: ['school_admin'] },
  { path: '/admin/roles', label: 'app.nav.roles', roles: ['school_admin'] },
  { path: '/settings', label: 'nav.settings' },
  // ── Features add nav items below this line ──
]

/** Roles allowed on a route, or undefined when everyone is. */
export function rolesForPath(path: string): AltamyraRole[] | undefined {
  return nav.find((n) => n.path === path)?.roles
}
