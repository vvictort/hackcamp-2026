import { useId, type Key, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui'
import { Logo, LogoMark } from '../LogoMark'
import { cn } from '@/lib/utils'
import { APP_NAME } from '@/constants'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useLang } from '@/i18n'

interface AuthLayoutProps {
  /** The page's one h1. */
  title: ReactNode
  description?: ReactNode
  /** The form (and OAuthButtons). */
  children: ReactNode
  /** Below a divider: the switch link, e.g. "New to Altamyra? Create an account". */
  footer?: ReactNode
  /** One line of product copy for an ink side panel, shown on lg only. */
  aside?: ReactNode
  /** Above the heading and outside `contentKey`, e.g. a step indicator that persists across stages. */
  eyebrow?: ReactNode
  /** Change it to re-mount (and re-rise) the heading, content and footer, e.g. per stage. */
  contentKey?: Key
  /** Makes the h1 focusable from script (tabIndex -1), for moving focus on a stage change. */
  headingRef?: Ref<HTMLHeadingElement>
  className?: string
}

/**
 * Centred sign-in / sign-up frame on the grey canvas: the brand logo, then a
 * white card with the h1, description, content and footer. The card rises in
 * on load and its content stack follows one --stagger step apart, the same
 * language as PageHeader + stagger-rise on app pages.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
  aside,
  eyebrow,
  contentKey,
  headingRef,
  className,
}: AuthLayoutProps) {
  const titleId = useId()
  const { t } = useLang()
  return (
    <div className={cn('flex justify-center py-2 sm:py-8 lg:min-h-[calc(100dvh-3rem)] lg:items-center lg:py-0', className)}>
      <div
        className={cn(
          'grid w-full gap-6',
          aside ? 'max-w-md lg:max-w-5xl lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]' : 'max-w-md',
        )}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" aria-label={t('auth.home', { app: APP_NAME })} className="inline-flex min-h-11 animate-rise items-center rounded-full">
              <Logo />
            </Link>
            <LanguageSwitcher className="h-11 w-auto min-w-0 max-w-[60%] shrink-0 gap-2 rounded-full" />
          </div>
          <Card aria-labelledby={titleId} className="animate-rise gap-0 p-6 sm:p-8">
            {eyebrow && <div className="mb-6">{eyebrow}</div>}
            <div key={contentKey} className="stagger-rise flex flex-col gap-8">
              <header className="flex flex-col gap-2">
                <h1
                  id={titleId}
                  ref={headingRef}
                  tabIndex={headingRef ? -1 : undefined}
                  className="text-h1 font-extrabold focus:outline-none sm:text-display-sm"
                >
                  {title}
                </h1>
                {description && <p className="text-body text-muted-foreground">{description}</p>}
              </header>
              <div className="flex flex-col gap-8">{children}</div>
              {footer && (
                <div className="border-t border-border pt-6 text-body text-muted-foreground">{footer}</div>
              )}
            </div>
          </Card>
        </div>

        {aside && (
          <div className="hidden animate-rise flex-col justify-between gap-10 rounded-lg bg-ink p-10 text-ink-foreground shadow-ink [animation-delay:var(--stagger)] lg:flex">
            <LogoMark inverted className="size-12" />
            <p className="max-w-[18ch] text-display-sm font-extrabold">{aside}</p>
          </div>
        )}
      </div>
    </div>
  )
}
