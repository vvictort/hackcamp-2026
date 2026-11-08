import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-label font-semibold transition-[color,background-color,translate,box-shadow,filter] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 shrink-0 [&_svg]:shrink-0 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-ink hover:bg-primary-soft',
        destructive:
          'bg-destructive text-destructive-foreground shadow-raised hover:shadow-lift',
        outline:
          'border border-border bg-card text-foreground shadow-raised hover:shadow-lift',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-border',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-foreground underline underline-offset-4 hover:decoration-2',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-11 px-3 text-small',
        lg: 'h-12 px-6 text-body',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading = false, disabled, children, type, ...props }, ref) => (
    <button
      ref={ref}
      data-slot="button"
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

export { Button, buttonVariants }
