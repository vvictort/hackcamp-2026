import * as React from 'react'

import { cn } from '@/lib/utils'

type Variant = 'default' | 'destructive' | 'outline' | 'raised' | 'secondary' | 'ghost' | 'link'
type Size = 'default' | 'sm' | 'lg' | 'icon'

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground shadow-ink hover:bg-primary-soft',
  destructive: 'bg-destructive text-destructive-foreground shadow-raised hover:shadow-lift',
  outline: 'border border-border bg-card text-foreground shadow-raised hover:shadow-lift',
  /* White pill or round icon button on the grey canvas. */
  raised: 'bg-card text-foreground shadow-raised hover:bg-secondary hover:shadow-lift',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-border',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-foreground underline underline-offset-4 hover:decoration-2',
}

const SIZES: Record<Size, string> = {
  default: 'h-11 px-4',
  sm: 'h-11 px-3 text-small',
  lg: 'h-12 px-6 text-body',
  icon: 'size-11',
}

interface ButtonStyle {
  variant?: Variant
  size?: Size
  className?: string
}

function buttonVariants({ variant = 'default', size = 'default', className }: ButtonStyle = {}) {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-label font-semibold transition-[color,background-color,translate,box-shadow,filter] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 shrink-0 [&_svg]:shrink-0 aria-invalid:border-destructive",
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export interface ButtonProps extends React.ComponentProps<'button'>, Omit<ButtonStyle, 'className'> {
  loading?: boolean
}

function Button({ className, variant, size, loading = false, disabled, children, type, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type ?? 'button'}
      className={buttonVariants({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

/** The loading ring Button shows; also usable on its own beside a status word. */
function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  )
}

export { Button, buttonVariants, Spinner }
