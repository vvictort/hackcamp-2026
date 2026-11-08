import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

interface Action {
  label: string
  onClick: () => void
}

interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: ReactNode
  title: string
  description?: string
  action?: Action
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-4 py-16 text-center', className)}
      {...props}
    >
      {icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      )}
      <h2 className="text-h2 font-extrabold">{title}</h2>
      {description && (
        <p className="mt-2 max-w-sm text-body text-muted-foreground">{description}</p>
      )}
      {action && (
        <div className="mt-5 flex items-center gap-2">
          <Button onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
    </div>
  )
}
