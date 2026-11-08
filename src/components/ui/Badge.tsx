import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'

const VARIANTS: Record<Variant, string> = {
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border border-border bg-card text-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
}

export interface BadgeProps extends ComponentProps<'span'> {
  variant: Variant
}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1 self-start whitespace-nowrap rounded-full px-2.5 text-small font-semibold [&_svg]:size-4 [&_svg]:shrink-0',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
