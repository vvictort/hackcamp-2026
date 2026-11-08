/**
 * App navigation: a slim icon sidebar on large screens and a top bar on small
 * ones, rendered ONCE (one grid that becomes a column at lg), so each control
 * and test id exists a single time. Routed items come from src/nav.ts;
 * planned modules without a page show an "Example only" note. Sign-in links
 * to /sign-in?next=<current path>, sign-out from the account menu.
 * Keep the data-testid hooks (`app-navigation`, `nav-sign-in-button`,
 * `nav-user-name`, `nav-user-email`) and the "Account menu" button name: the
 * shipped tests rely on them.
 */

import { Link, useLocation } from 'react-router-dom'
import { useAuthProfileReady } from 'deepspace'
import {
  Activity,
  FileText,
  Handshake,
  House,
  LayoutGrid,
  LogIn,
  LogOut,
  ScanSearch,
  Settings,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { nav } from '../nav'
import { endSession } from '@/lib/session'
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
  useToast,
} from './ui'

type Item = { label: string; Icon: LucideIcon; to?: string }

/** Icons for routed entries in src/nav.ts; new entries fall back to LayoutGrid. */
const ICONS: Record<string, LucideIcon> = { '/home': House, '/settings': Settings }

/** Modules without a page yet: shown after Home, they explain instead of navigating. */
const PLANNED: Item[] = [
  { label: 'Students', Icon: UsersRound },
  { label: 'Lesson Lens', Icon: ScanSearch },
  { label: 'Pulse', Icon: Activity },
  { label: 'Progress drafts', Icon: FileText },
  { label: 'Team', Icon: Handshake },
]

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const { info } = useToast()
  const profileReady = !isSignedIn || (!userLoading && !!user)
  const role = user?.role
  const [first, ...rest] = nav
    .filter((n) => (!n.devOnly || import.meta.env.DEV) && (!n.roles || (role !== undefined && (n.roles as string[]).includes(role))))
    .map<Item>((n) => ({ label: n.label, to: n.path, Icon: ICONS[n.path] ?? LayoutGrid }))
  const items = first ? [first, ...PLANNED, ...rest] : PLANNED

  const navItem = (item: Item) => {
    const active = !!item.to && location.pathname.startsWith(item.to)
    const className = cn(
      'inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[background-color,box-shadow,color]',
      active
        ? 'bg-primary text-primary-foreground lg:shadow-ink'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )
    const icon = <item.Icon className="size-5.5" strokeWidth={1.9} aria-hidden />
    const control = item.to ? (
      <Link to={item.to} aria-label={item.label} aria-current={active ? 'page' : undefined} className={className}>
        {icon}
      </Link>
    ) : (
      <button
        type="button"
        aria-label={item.label}
        className={className}
        onClick={() => info('Example only', `${item.label} is not built yet.`)}
      >
        {icon}
      </button>
    )
    return (
      <li key={item.label}>
        <Tooltip>
          <TooltipTrigger render={control} />
          <TooltipContent side="right">{item.label}</TooltipContent>
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
            <Button variant="raised" size="icon" aria-label="Account menu" className="size-12">
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
            <div className="truncate text-label font-semibold text-foreground">{user.name || 'Signed in'}</div>
            <div data-testid="nav-user-email" className="truncate text-small font-normal text-muted-foreground">
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => endSession()}>
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Link
        data-testid="nav-sign-in-button"
        to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}
        className={buttonVariants({ className: 'h-12 lg:size-12 lg:px-0' })}
      >
        <LogIn className="size-5" aria-hidden />
        <span className="lg:sr-only">Sign in</span>
      </Link>
    )

  return (
    <nav
        data-testid="app-navigation"
        aria-label="Main"
        className="sticky top-0 z-20 shrink-0 border-b border-border bg-card lg:top-6 lg:h-[calc(100dvh-3rem)] lg:w-22 lg:rounded-2xl lg:border-b-0 lg:py-6 lg:shadow-raised"
      >
        {/* Phones: brand + account on one row, icons in a scrollable row below.
            lg: the same elements stack into a vertical rail, account last. */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 lg:flex lg:h-full lg:flex-col lg:gap-10 lg:p-0">
          <Link to="/home" className="justify-self-start rounded-md">
            <Logo className="gap-3 text-h2" markClassName="size-11" labelClassName="lg:sr-only" />
          </Link>
          <div className="lg:order-last lg:mt-auto">{account}</div>
          <ul className="col-span-2 -mx-1 flex justify-between overflow-x-auto p-1 lg:mx-0 lg:flex-col lg:items-center lg:justify-start lg:gap-3 lg:overflow-visible lg:p-0">
            {items.map(navItem)}
          </ul>
        </div>
    </nav>
  )
}
