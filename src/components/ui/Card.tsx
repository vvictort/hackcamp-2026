import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends Omit<ComponentProps<'section'>, 'title'> {
  tone?: 'default' | 'ink'
  /** Renders the card's h2 and labels the section with it. */
  title?: ReactNode
}

/** The app's card surface: white (or ink) with depth, 20px corners, one padding and gap. */
export function Card({ tone = 'default', title, className, children, ...props }: CardProps) {
  const id = useId()
  return (
    <section
      aria-labelledby={title ? id : undefined}
      {...props}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-lg p-5 sm:p-6',
        tone === 'ink' ? 'bg-ink text-ink-foreground shadow-ink' : 'bg-card shadow-raised',
        className,
      )}
    >
      {title && (
        <h2 id={id} className="text-h2 font-extrabold">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}
