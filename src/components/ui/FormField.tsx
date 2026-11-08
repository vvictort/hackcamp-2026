import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from './Label'

/** What FormField hands its control. Spread it onto the Input. */
export interface FormFieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  'aria-required'?: true
}

interface FormFieldProps {
  label: ReactNode
  /** Shows an asterisk and sets aria-required. Native `required` is left off
   *  so the browser's own bubbles do not fight inline validation. */
  required?: boolean
  /** Helper text; the error replaces it while one is shown. */
  hint?: ReactNode
  /** Shown with an icon (and "Error:" for screen readers). Falsy = valid. */
  error?: ReactNode
  /** Defaults to a generated id. */
  id?: string
  className?: string
  /** One element (it receives the props), or a render prop for custom wiring. */
  children: ReactElement<FormFieldControlProps> | ((control: FormFieldControlProps) => ReactNode)
}

/**
 * Label, control and one message line. The message line is always rendered
 * at one line of text-small (min-h-5), so an error appearing never moves the
 * fields below it. Spacing: label to control gap-2, control to message 1.5.
 */
export function FormField({ label, required, hint, error, id: idProp, className, children }: FormFieldProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const messageId = `${id}-message`
  const control: FormFieldControlProps = {
    id,
    'aria-describedby': error || hint ? messageId : undefined,
    'aria-invalid': error ? true : undefined,
    'aria-required': required || undefined,
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>
          {label}
          {required && (
            <span aria-hidden className="ml-1 text-destructive-strong">
              *
            </span>
          )}
        </Label>
        {typeof children === 'function' ? children(control) : cloneElement(children, control)}
      </div>
      <p id={messageId} className="mt-1.5 min-h-5 text-small">
        {error ? (
          <span
            key={typeof error === 'string' ? error : undefined}
            className="flex animate-in items-start gap-1.5 font-semibold text-destructive-strong fade-in-0 [--tw-enter-translate-y:-0.25rem]"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="sr-only">Error: </span>
              {error}
            </span>
          </span>
        ) : (
          hint && <span className="text-muted-foreground">{hint}</span>
        )}
      </p>
    </div>
  )
}
