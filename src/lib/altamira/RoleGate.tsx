/**
 * Page guard: renders its children only when the active role may use the route
 * (roles come from src/nav.ts, the same list the sidebar uses). Anyone else sees
 * an access-denied state with an icon and text, so a pasted URL never opens a
 * screen the role should not have.
 */

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Card, EmptyState, Spinner } from '@/components/ui'
import { useLang } from '@/i18n'
import { rolesForPath } from '@/nav'
import { useAltamiraMe, type AltamiraRole } from './role'

export const START_PATH: Record<AltamiraRole, string> = {
  ea: '/home',
  teacher: '/home',
  case_manager: '/home',
  parent: '/family',
  district_lead: '/insights',
  school_admin: '/admin/tickets',
}

/** True when `role` may open `path` (a nav route). Unlisted routes are open. */
export function canOpen(path: string, role: AltamiraRole | null): boolean {
  const allowed = rolesForPath(path)
  return !allowed || (role !== null && allowed.includes(role))
}

export function RoleGate({ path, children }: { path: string; children: ReactNode }) {
  const { role, loading } = useAltamiraMe()
  const { t } = useLang()
  const go = useNavigate()
  if (loading)
    return (
      <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
        <Spinner /> {t('app.home.loading')}
      </p>
    )
  if (canOpen(path, role)) return <>{children}</>
  return (
    <Card>
      <EmptyState
        icon={<ShieldAlert aria-hidden />}
        title={t('app.denied.title')}
        description={t('app.denied.body')}
        action={{ label: t('app.denied.home'), onClick: () => go(role ? START_PATH[role] : '/home') }}
      />
    </Card>
  )
}
