/**
 * Routed navigation entries. Navigation.tsx renders these (filtered by role
 * and devOnly), giving each an icon from its ICONS map, with a fallback for
 * entries `deepspace add` inserts below the marker line.
 */

import type { Role } from 'deepspace'
import type { MessageKey } from '@/i18n/en'

export interface NavItem {
  path: string
  /** i18n key, translated at render. */
  label: MessageKey
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'nav.home' },
  { path: '/settings', label: 'nav.settings' },
  // The /api-status debug page still exists: add
  // `{ path: '/api-status', label: 'app.nav.apiStatus', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]
