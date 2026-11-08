import { StatusBadge, type StatusTone } from '@/components/ui'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import type { DecisionRule, ObjectiveStatus } from '@/server/altamyra/contract/enums'

export const DECISION_TONE: Record<DecisionRule, StatusTone> = { below_aimline: 'warning', above_aimline: 'success', data_needed: 'info' }
const DECISION_KEY: Record<DecisionRule, MessageKey> = {
  below_aimline: 'students.decision.below',
  above_aimline: 'students.decision.above',
  data_needed: 'students.decision.needed',
}
export const DECISION_HELP: Record<DecisionRule, MessageKey> = {
  below_aimline: 'students.decision.belowHelp',
  above_aimline: 'students.decision.aboveHelp',
  data_needed: 'students.decision.neededHelp',
}

export function DecisionBadge({ rule }: { rule: DecisionRule | null }) {
  const { t } = useLang()
  if (!rule) return <StatusBadge tone="info">{t('students.decision.none')}</StatusBadge>
  return <StatusBadge tone={DECISION_TONE[rule]}>{t(DECISION_KEY[rule])}</StatusBadge>
}

export const OBJECTIVE_TONE: Record<ObjectiveStatus, StatusTone> = { proposed: 'info', confirmed: 'success', flagged_unmeasurable: 'warning' }
const OBJECTIVE_KEY: Record<ObjectiveStatus, MessageKey> = {
  proposed: 'students.objective.proposed',
  confirmed: 'students.objective.confirmed',
  flagged_unmeasurable: 'students.objective.flagged',
}
export function ObjectiveBadge({ status }: { status: ObjectiveStatus }) {
  const { t } = useLang()
  return <StatusBadge tone={OBJECTIVE_TONE[status]}>{t(OBJECTIVE_KEY[status])}</StatusBadge>
}

export function GoalStateBadge({ status }: { status: 'active' | 'closed' }) {
  const { t } = useLang()
  return <StatusBadge tone={status === 'active' ? 'success' : 'info'}>{t(status === 'active' ? 'students.goal.active' : 'students.goal.closed')}</StatusBadge>
}

export function PointStatusBadge({ status }: { status: 'confirmed' | 'auto_confirmed' | 'pending_review' }) {
  const { t } = useLang()
  return status === 'pending_review' ? (
    <StatusBadge tone="warning">{t('students.point.pending')}</StatusBadge>
  ) : (
    <StatusBadge tone="success">{t(status === 'confirmed' ? 'students.point.confirmed' : 'students.point.auto')}</StatusBadge>
  )
}
