import { cn } from '@/lib/utils'

/**
 * A thin bar that fills once on load. Pass `label` to expose it as a
 * progressbar; without it the bar is hidden from assistive tech because the
 * number is already shown as text.
 */
export function Progress({
  value,
  label,
  tone = 'default',
  className,
}: {
  /** 0 to 100. */
  value: number
  label?: string
  tone?: 'default' | 'signal'
  className?: string
}) {
  return (
    <div
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-valuenow={label ? value : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-hidden={label ? undefined : true}
      className={cn('h-2 overflow-hidden rounded-full bg-secondary', className)}
    >
      <div
        className={cn('animate-grow h-full rounded-full', tone === 'signal' ? 'bg-signal' : 'bg-foreground')}
        style={{ width: `${value}%` }}
      />
    </div>
  )
}
