import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * States: default (grey border), hover (ink border), keyboard focus (the
 * global 2px ink ring in styles.css), aria-invalid (2px destructive-strong
 * border, drawn with an inset shadow so the text does not shift) and disabled.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-body text-foreground transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-small file:font-semibold file:text-foreground placeholder:text-muted-foreground enabled:hover:border-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive-strong aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive-strong)] enabled:aria-invalid:hover:border-destructive-strong',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

/** Input with a show/hide toggle. Pass autoComplete="current-password" or "new-password". */
const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<'input'>, 'type'>>(
  ({ className, disabled, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    const Icon = visible ? EyeOff : Eye
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-12', className)}
          disabled={disabled}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={props.id}
          disabled={disabled}
          className="absolute inset-y-0 right-0 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <Icon aria-hidden className="size-5" />
        </button>
      </div>
    )
  }
)
PasswordInput.displayName = 'PasswordInput'

export { Input, PasswordInput }
