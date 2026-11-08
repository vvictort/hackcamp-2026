/**
 * Routed navigation entries. Navigation.tsx renders these (filtered by role
 * and devOnly), giving each an icon from its ICONS map, with a fallback for
 * entries `deepspace add` inserts below the marker line.
 */

import type { Role } from 'deepspace'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Home' },
  { path: '/settings', label: 'Settings' },
  // The /api-status debug page still exists: add
  // `{ path: '/api-status', label: 'API Status', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]
