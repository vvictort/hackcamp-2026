import { Badge, StatusBadge, type StatusTone } from '@/components/ui'
import type { DecisionRule, ObjectiveStatus } from '@/server/altamyra/contract/enums'
import { s, type SKey } from './text'

export const DECISION_TONE: Record<DecisionRule, StatusTone> = { below_aimline: 'warning', above_aimline: 'success', data_needed: 'info' }
const DECISION_KEY: Record<DecisionRule, SKey> = {
  below_aimline: 'students.decision.below',
  above_aimline: 'students.decision.above',
  data_needed: 'students.decision.needed',
}
const DECISION_HELP: Record<DecisionRule, SKey> = {
  below_aimline: 'students.decision.belowHelp',
  above_aimline: 'students.decision.aboveHelp',
  data_needed: 'students.decision.neededHelp',
}
export const decisionLabel = (r: DecisionRule) => s(DECISION_KEY[r])
export const decisionHelp = (r: DecisionRule) => s(DECISION_HELP[r])

export function DecisionBadge({ rule }: { rule: DecisionRule | null }) {
  if (!rule) return <StatusBadge tone="info">{s('students.decision.none')}</StatusBadge>
  return <StatusBadge tone={DECISION_TONE[rule]}>{decisionLabel(rule)}</StatusBadge>
}

export const OBJECTIVE_TONE: Record<ObjectiveStatus, StatusTone> = { proposed: 'info', confirmed: 'success', flagged_unmeasurable: 'warning' }
const OBJECTIVE_KEY: Record<ObjectiveStatus, SKey> = {
  proposed: 'students.objective.proposed',
  confirmed: 'students.objective.confirmed',
  flagged_unmeasurable: 'students.objective.flagged',
}
export const ObjectiveBadge = ({ status }: { status: ObjectiveStatus }) => (
  <StatusBadge tone={OBJECTIVE_TONE[status]}>{s(OBJECTIVE_KEY[status])}</StatusBadge>
)

export const GoalStateBadge = ({ status }: { status: 'active' | 'closed' }) => (
  <StatusBadge tone={status === 'active' ? 'success' : 'info'}>{s(status === 'active' ? 'students.goal.active' : 'students.goal.closed')}</StatusBadge>
)

export const PointStatusBadge = ({ status }: { status: 'confirmed' | 'auto_confirmed' | 'pending_review' }) =>
  status === 'pending_review' ? (
    <StatusBadge tone="warning">{s('students.point.pending')}</StatusBadge>
  ) : (
    <StatusBadge tone="success">{s(status === 'confirmed' ? 'students.point.confirmed' : 'students.point.auto')}</StatusBadge>
  )

