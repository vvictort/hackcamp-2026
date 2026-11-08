import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'
type Size = 'default' | 'sm' | 'lg'

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border border-border bg-card text-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
}

const SIZES: Record<Size, string> = {
  default: 'min-h-7 px-2.5 text-small',
  sm: 'min-h-6 px-2 text-small',
  lg: 'min-h-8 px-3 text-body',
}

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: Variant
  size?: Size
}

export function Badge({ className, variant = 'default', size = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold [&_svg]:size-4 [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
