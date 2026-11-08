import { useState } from 'react'
import { Button, Card } from '@/components/ui'
import { getAimline, getGoalStatus } from '@/lib/altamyra/students-api'
import type { Goal, Objective } from '@/server/altamyra/contract/student'
import { AimlineChart } from './AimlineChart'
import { DECISION_HELP, DecisionBadge, GoalStateBadge } from './badges'
import { ObjectivesPanel } from './ObjectivesPanel'
import { ProficiencyPanel } from './ProficiencyPanel'
import { QuickRating } from './QuickRating'
import { LoadError, useLoad } from '@/lib/useLoad'
import { useLang } from '@/i18n'

interface Props {
  studentId: string
  goal: Goal
  objectives: Objective[]
  canConfirm: boolean
  /** Teacher or case manager: quick rating and proficiency. */
  canRate?: boolean
  onChanged: () => void
}

/** One goal: state, decision-rule result, objectives, and an on-demand aimline chart. */
export function GoalCard({ studentId, goal, objectives, canConfirm, canRate = false, onChanged }: Props) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [profOpen, setProfOpen] = useState(false)
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
          {status.data.latestDecision && <p>{t(DECISION_HELP[status.data.latestDecision])}</p>}
          <p>
            {status.data.current === null
              ? t('students.goal.noData')
              : t('students.goal.current', { current: status.data.current, target: status.data.target ?? '-', unit, n: status.data.recentCount })}
          </p>
          {status.data.projectedDate && <p>{t('students.goal.projected', { date: status.data.projectedDate })}</p>}
        </div>
      )}
      <h3 className="text-label font-semibold">{t('students.objectives')}</h3>
      <ObjectivesPanel studentId={studentId} objectives={objectives} canConfirm={canConfirm} onChanged={onChanged} />
      {canRate && <QuickRating studentId={studentId} objective={objectives.find((o) => o.status === 'confirmed')} onSaved={onChanged} />}
      <div className="flex flex-wrap gap-2">
        {canRate && status.status === 'ready' && (
          <Button variant="outline" size="sm" aria-expanded={profOpen} onClick={() => setProfOpen((v) => !v)}>{t('students.prof.open')}</Button>
        )}
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('students.goal.hideChart') : t('students.goal.showChart')}
        </Button>
      </div>
      {profOpen && status.status === 'ready' && <ProficiencyPanel studentId={studentId} goalId={goal.id} status={status.data} />}
      {open && <GoalChart studentId={studentId} goalId={goal.id} unit={unit} />}
    </Card>
  )
}

function GoalChart({ studentId, goalId, unit }: { studentId: string; goalId: string; unit: string }) {
  const { t } = useLang()
  const aim = useLoad(() => getAimline(studentId, goalId), goalId)
  if (aim.status === 'loading') return <p role="status" className="text-small text-muted-foreground">{t('students.loading')}</p>
  if (aim.status === 'error') return <LoadError error={aim.error} />
  return <AimlineChart data={aim.data} unit={unit} />
}
