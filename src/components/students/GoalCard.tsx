import { useState } from 'react'
import { Button, Card } from '@/components/ui'
import { getAimline, getGoalStatus } from '@/lib/altamira/students-api'
import type { Goal, Objective } from '@/server/altamira/contract/student'
import { AimlineChart } from './AimlineChart'
import { DecisionBadge, GoalStateBadge, decisionHelp } from './badges'
import { ObjectivesPanel } from './ObjectivesPanel'
import { s } from './text'
import { useLoad } from './useLoad'

interface Props {
  studentId: string
  goal: Goal
  objectives: Objective[]
  canConfirm: boolean
  onChanged: () => void
}

/** One goal: state, decision-rule result, objectives, and an on-demand aimline chart. */
export function GoalCard({ studentId, goal, objectives, canConfirm, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const status = useLoad(() => getGoalStatus(studentId, goal.id), `${goal.id}:${objectives.map((o) => o.version).join()}`)
  const unit = objectives[0]?.unit ?? ''
  return (
    <Card title={goal.area}>
      <div className="flex flex-wrap items-center gap-2">
        <GoalStateBadge status={goal.status} />
        {status.status === 'ready' && <DecisionBadge rule={status.data.latestDecision} />}
      </div>
      <p className="text-body">{goal.text}</p>
      {status.status === 'ready' && (
        <div className="flex flex-col gap-1 text-small text-muted-foreground">
          {status.data.latestDecision && <p>{decisionHelp(status.data.latestDecision)}</p>}
          <p>
            {status.data.current === null
              ? s('students.goal.noData')
              : s('students.goal.current', { current: status.data.current, target: status.data.target ?? '-', unit, n: status.data.recentCount })}
          </p>
          {status.data.projectedDate && <p>{s('students.goal.projected', { date: status.data.projectedDate })}</p>}
        </div>
      )}
      <h3 className="text-label font-semibold">{s('students.objectives')}</h3>
      <ObjectivesPanel studentId={studentId} objectives={objectives} canConfirm={canConfirm} onChanged={onChanged} />
      <div>
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? s('students.goal.hideChart') : s('students.goal.showChart')}
        </Button>
      </div>
      {open && <GoalChart studentId={studentId} goalId={goal.id} unit={unit} />}
    </Card>
  )
}

function GoalChart({ studentId, goalId, unit }: { studentId: string; goalId: string; unit: string }) {
  const aim = useLoad(() => getAimline(studentId, goalId), goalId)
  if (aim.status === 'loading') return <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>
  if (aim.status === 'error') return <p role="alert" className="text-small">{aim.error.message}</p>
  return <AimlineChart data={aim.data} unit={unit} />
}
