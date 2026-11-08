import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react'
import { Badge, type BadgeProps } from './Badge'

/**
 * A status shown as an icon plus a word, never color alone.
 * success: Submitted, On track · warning: Due soon, Late
 * destructive: Missing · info: Feedback ready, New
 */
const ICONS = {
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleX,
  info: Info,
} as const

export type StatusTone = keyof typeof ICONS

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  tone: StatusTone
}

export function StatusBadge({ tone, children, ...props }: StatusBadgeProps) {
  const Icon = ICONS[tone]
  return (
    <Badge variant={tone} {...props}>
      <Icon aria-hidden />
      {children}
    </Badge>
  )
}
