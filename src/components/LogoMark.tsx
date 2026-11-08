import { APP_NAME } from '../constants'
import { cn } from '@/lib/utils'

/** Altamira mark: one arch, the cave the name comes from and an "A". Keep in sync with public/favicon.svg. */
export function LogoMark({ inverted = false, className = 'size-9' }: { inverted?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className={className}>
      <path
        d="M6.5 27V16a9.5 9.5 0 0 1 19 0v11"
        fill="none"
        strokeWidth="4.5"
        strokeLinecap="round"
        className={inverted ? 'stroke-ink-foreground' : 'stroke-foreground'}
      />
    </svg>
  )
}

/** Mark plus the app name. `markClassName` undefined keeps the mark's size-9 default. */
export function Logo({
  inverted = false,
  className,
  markClassName,
  labelClassName,
}: {
  inverted?: boolean
  className?: string
  markClassName?: string
  labelClassName?: string
}) {
  return (
    <span className={cn('flex items-center gap-2.5 text-h3 font-bold', className)}>
      <LogoMark inverted={inverted} className={markClassName} />
      <span className={labelClassName}>{APP_NAME}</span>
    </span>
  )
}
