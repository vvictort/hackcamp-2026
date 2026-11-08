import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A page's h1, its one-line description and optional actions. Rises in on load. */
export function PageHeader({
  title,
  description,
  actions,
  className,
  titleClassName,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  /** Only for the dashboard greeting's larger sm:text-hero. */
  titleClassName?: string
}) {
  return (
    <header className={cn('animate-rise flex flex-wrap items-start justify-between gap-6 lg:pt-1', className)}>
      <div className="flex flex-col gap-2">
        <h1 className={cn('text-display font-extrabold', titleClassName)}>{title}</h1>
        {description && <p className="max-w-[60ch] text-body-lg text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </header>
  )
}
