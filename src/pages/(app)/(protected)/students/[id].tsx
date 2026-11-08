import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileUp, Send } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { GoalCard } from '@/components/students/GoalCard'
import { IepImportDialog } from '@/components/students/IepImportDialog'
import { HandoffDialog } from '@/components/students/HandoffDialog'
import { ParentInputPanel } from '@/components/students/ParentInputPanel'
import { ProposalForm } from '@/components/students/ProposalForm'
import { ProposalsPanel } from '@/components/students/ProposalsPanel'
import { Timeline } from '@/components/students/Timeline'
import { WhatWorks } from '@/components/students/WhatWorks'
import { fmtDate, s } from '@/components/students/text'
import { useLoad } from '@/components/students/useLoad'
import { getMe, getObjectives, getProfile, getTimeline } from '@/lib/altamira/students-api'

const List = ({ items }: { items: string[] }) =>
  items.length === 0 ? (
    <p className="text-small text-muted-foreground">{s('students.none')}</p>
  ) : (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => <li key={x}><Badge variant="secondary" className="whitespace-normal">{x}</Badge></li>)}
    </ul>
  )

export default function StudentProfilePage() {
  const { id = '' } = useParams()
  const [rev, setRev] = useState(0)
  const [importing, setImporting] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const handoffParam = params.get('handoff')
  const bump = () => setRev((n) => n + 1)

  const me = useLoad(getMe, 'me')
  const profile = useLoad(() => getProfile(id), `${id}:${rev}`)
  const full = profile.status === 'ready' && profile.data.view === 'full'
  const objectives = useLoad(() => getObjectives(id), full ? `${id}:${rev}` : null)
  const timeline = useLoad(() => getTimeline(id), profile.status === 'ready' ? `${id}:${rev}` : null)

  const roles = me.status === 'ready' ? ([...me.data.caseload, ...me.data.students].find((x) => x.id === id)?.roles ?? []) : []
  const isCm = roles.includes('case_manager')
  const canPropose = isCm || roles.includes('teacher')

  if (profile.status === 'loading') return <p role="status" className="text-muted-foreground">{s('students.loading')}</p>
  if (profile.status === 'error')
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{profile.error.message}</p>
        <Button variant="outline" className="self-start" onClick={profile.reload}>{s('students.retry')}</Button>
      </div>
    )

  const p = profile.data
  const back = (
    <Link to="/students" className="inline-flex min-h-11 items-center gap-1 self-start rounded-full text-label font-semibold">
      <ArrowLeft className="size-4" aria-hidden />
      {s('students.back')}
    </Link>
  )

  if (p.view === 'supports') {
    return (
      <div className="flex w-full max-w-4xl flex-col gap-6">
        {back}
        <PageHeader title={p.firstName ?? s('students.student')} description={s('students.supportsView')} />
        <Card title={s('students.supports')}><List items={p.supports} /></Card>
        <WhatWorks studentId={id} />
      </div>
    )
  }

  const objs = objectives.status === 'ready' ? objectives.data.objectives : []
  const sec = p.sections
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      {back}
      <PageHeader
        title={p.displayToken}
        description={s('students.profile.summary', { grade: p.grade, version: p.iepVersion ?? '-', review: fmtDate(sec?.reviewDate) || '-' })}
        actions={
          isCm && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setHandoffOpen(true)}><Send aria-hidden />{s('students.handoff.open')}</Button>
              <Button onClick={() => setImporting(true)}><FileUp aria-hidden />{s('students.import.open')}</Button>
            </div>
          )
        }
      />
      {roles.length > 0 && <p className="flex flex-wrap gap-2">{roles.map((r) => <Badge key={r} variant="outline">{r.replace('_', ' ')}</Badge>)}</p>}

      {!sec ? (
        <Card title={s('students.noIep')}>
          <p className="text-body text-muted-foreground">{s(isCm ? 'students.noIepCm' : 'students.noIepOther')}</p>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title={s('students.strengths')}><List items={sec.profile.strengths} /></Card>
          <Card title={s('students.accommodations')}><List items={sec.accommodations} /></Card>
          <Card title={s('students.supports')}><List items={sec.supports} /></Card>
          <Card title={s('students.modifications')}>
            {sec.modifications.length === 0 ? (
              <p className="text-small text-muted-foreground">{s('students.none')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-body">
                {sec.modifications.map((m) => <li key={m.subject}><strong>{m.subject}</strong>: {m.description}</li>)}
              </ul>
            )}
          </Card>
        </div>
      )}

      {p.goals.length > 0 && (
        <section aria-labelledby="goals-h" className="flex flex-col gap-4">
          <h2 id="goals-h" className="text-h2 font-extrabold">{s('students.goals')}</h2>
          {objectives.status === 'error' && <p role="alert" className="text-small">{objectives.error.message}</p>}
          {p.goals.map((g) => (
            <GoalCard key={g.id} studentId={id} goal={g} objectives={objs.filter((o) => o.goalId === g.id)} canConfirm={isCm} canRate={canPropose} onChanged={bump} />
          ))}
        </section>
      )}

      {timeline.status === 'ready' ? (
        <Timeline studentId={id} dataPoints={timeline.data.dataPoints} decisions={timeline.data.decisions} goals={p.goals} objectives={objs} />
      ) : timeline.status === 'error' ? (
        <Card title={s('students.timeline')}><p role="alert" className="text-small">{timeline.error.message}</p></Card>
      ) : null}

      <WhatWorks studentId={id} />

      {canPropose && !isCm && (
        <ProposalForm studentId={id} goals={p.goals} dataPoints={timeline.status === 'ready' ? timeline.data.dataPoints : []} onSent={bump} />
      )}
      {canPropose && <ProposalsPanel studentId={id} canResolve={isCm} refreshKey={rev} onResolved={bump} />}

      {isCm && <ParentInputPanel studentId={id} />}

      <HandoffDialog studentId={id} canCreate={isCm} open={handoffOpen} onOpenChange={setHandoffOpen} />
      <HandoffDialog
        studentId={id}
        canCreate={false}
        open={!!handoffParam}
        handoffId={handoffParam}
        onOpenChange={(o) => { if (!o) setParams((p) => { p.delete('handoff'); return p }, { replace: true }) }}
      />
      <IepImportDialog studentId={id} open={importing} onOpenChange={setImporting} onConfirmed={bump} />
    </div>
  )
}
