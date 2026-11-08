import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Renders the card's h2 and labels the section with it. */
  title?: ReactNode
}

/** The app's card surface: white with depth, 20px corners, one padding and gap. */
export function Card({ title, className, children, ...props }: CardProps) {
  const id = useId()
  return (
    <section
      aria-labelledby={title ? id : undefined}
      {...props}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-lg bg-card p-5 shadow-raised sm:p-6',
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
