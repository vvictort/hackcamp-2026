/**
 * App navigation: a slim icon sidebar on large screens and a top bar on small
 * ones, rendered ONCE (one grid that becomes a column at lg), so each control
 * and test id exists a single time. Routed items come from src/nav.ts;
 * every item links to a built page, filtered by the Altamyra role. Sign-in links
 * to /sign-in?next=<current path>, sign-out from the account menu.
 * Keep the data-testid hooks (`app-navigation`, `nav-sign-in-button`,
 * `nav-user-name`, `nav-user-email`) and the "Account menu" button name: the
 * shipped tests rely on them.
 */

import { Link, useLocation } from 'react-router'
import { useAuthProfileReady } from 'deepspace'
import {
  Camera,
  ChartColumn,
  FileText,
  KeyRound,
  MoonStar,
  TicketCheck,
  TrendingUp,
  House,
  LayoutGrid,
  LogIn,
  LogOut,
  Settings,
  UsersRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { nav } from '../nav'
import { endSession } from '@/lib/session'
import { useAltamyraMe } from '@/lib/altamyra/role'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { Logo } from './LogoMark'
import { cn, initialOf } from '../lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  buttonVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui'

type Item = { label: MessageKey; Icon: LucideIcon; to: string }

/** Icons for routed entries in src/nav.ts; new entries fall back to LayoutGrid. */
const ICONS: Record<string, LucideIcon> = {
  '/home': House,
  '/students': UsersRound,
  '/capture': Camera,
  '/progress': TrendingUp,
  '/summaries': FileText,
  '/end-of-day': MoonStar,
  '/admin/tickets': TicketCheck,
  '/admin/roles': KeyRound,
  '/family': Users,
  '/insights': ChartColumn,
  '/settings': Settings,
}

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const { t } = useLang()
  const { role, devEnabled } = useAltamyraMe()
  const profileReady = !isSignedIn || (!userLoading && !!user)
  const items = nav
    .filter((n) => !n.hidden)
    .filter((n) => !n.roles || (role !== null && n.roles.includes(role)) || (devEnabled && n.showInDemo))
    .map<Item>((n) => ({ label: n.label, to: n.path, Icon: ICONS[n.path] ?? LayoutGrid }))

  const navItem = (item: Item) => {
    const active = location.pathname.startsWith(item.to)
    const className = cn(
      'inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[background-color,box-shadow,color]',
      active
        ? 'bg-primary text-primary-foreground shadow-ink'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )
    const icon = <item.Icon className="size-5.5" strokeWidth={1.9} aria-hidden />
    const control = (
      <Link to={item.to} aria-label={t(item.label)} aria-current={active ? 'page' : undefined} className={className}>
        {icon}
      </Link>
    )
    return (
      <li key={item.label}>
        <Tooltip>
          <TooltipTrigger render={control} />
          <TooltipContent side="right">{t(item.label)}</TooltipContent>
        </Tooltip>
      </li>
    )
  }

  const account =
    !isLoaded ? null : isSignedIn && !profileReady ? (
      <div aria-hidden className="size-12 animate-pulse rounded-full bg-muted" />
    ) : isSignedIn && user ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="raised" size="icon" aria-label={t('app.nav.accountMenu')} className="size-12">
              <Avatar className="size-10">
                <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                <AvatarFallback className="bg-secondary text-label font-bold text-foreground">
                  {initialOf(user)}
                </AvatarFallback>
              </Avatar>
              <span data-testid="nav-user-name" className="sr-only">
                {user.name || user.email}
              </span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="truncate text-label font-semibold text-foreground">{user.name || t('app.nav.signedIn')}</div>
            <div data-testid="nav-user-email" className="truncate text-small font-normal text-muted-foreground">
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => endSession()}>
            <LogOut aria-hidden />
            {t('common.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Link
        data-testid="nav-sign-in-button"
        to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        className={buttonVariants({ className: 'h-12 md:size-12 md:px-0' })}
      >
        <LogIn className="size-5" aria-hidden />
        <span className="md:sr-only">{t('common.signIn')}</span>
      </Link>
    )

  return (
    <nav
        data-testid="app-navigation"
        aria-label={t('app.nav.main')}
        className="sticky top-0 z-20 shrink-0 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] md:top-4 md:h-[calc(100dvh-2rem)] md:w-22 md:rounded-2xl md:border-b-0 md:bg-card md:py-6 md:shadow-raised lg:top-6 lg:h-[calc(100dvh-3rem)]"
      >
        {/* Phones: brand + account in a slim top bar, the icons in a tab bar
            fixed to the bottom (thumb reach). md and up: the same elements
            stack into the floating rail, account last. One render either way. */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:h-full md:flex-col md:justify-start md:gap-10 md:p-0">
          <Link to="/home" aria-hidden tabIndex={-1} className="rounded-md">
            <Logo className="gap-2.5 text-h3" markClassName="size-9 md:size-11" labelClassName="md:sr-only" />
          </Link>
          <div className="md:order-last md:mt-auto">{account}</div>
          {/* Phones: a floating island like the iOS tab bar, hugging its icons
              and centred above the home indicator. md: back in the rail. */}
          <ul className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-1 rounded-full bg-card p-1.5 shadow-lift md:static md:mx-0 md:w-auto md:max-w-none md:flex-col md:gap-3 md:rounded-none md:bg-transparent md:p-0 md:shadow-none">
            {items.map(navItem)}
          </ul>
        </div>
    </nav>
  )
}
