import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileUp } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '@/components/ui'
import { GoalCard } from '@/components/students/GoalCard'
import { IepImportDialog } from '@/components/students/IepImportDialog'
import { Timeline } from '@/components/students/Timeline'
import { WhatWorks } from '@/components/students/WhatWorks'
import { fmtDate, s } from '@/components/students/text'
import { useLoad } from '@/components/students/useLoad'
import { RoleGate } from '@/lib/altamira/RoleGate'
import { getMe, getObjectives, getProfile, getTimeline } from '@/lib/altamira/students-api'

const List = ({ items }: { items: string[] }) =>
  items.length === 0 ? (
    <p className="text-small text-muted-foreground">{s('students.none')}</p>
  ) : (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => <li key={x}><Badge variant="secondary" className="whitespace-normal">{x}</Badge></li>)}
    </ul>
  )

function StudentProfileBody() {
  const { id = '' } = useParams()
  const [rev, setRev] = useState(0)
  const [importing, setImporting] = useState(false)
  const bump = () => setRev((n) => n + 1)

  const me = useLoad(getMe, 'me')
  const profile = useLoad(() => getProfile(id), `${id}:${rev}`)
  const full = profile.status === 'ready' && profile.data.view === 'full'
  const objectives = useLoad(() => getObjectives(id), full ? `${id}:${rev}` : null)
  const timeline = useLoad(() => getTimeline(id), profile.status === 'ready' ? `${id}:${rev}` : null)

  const roles = me.status === 'ready' ? ([...me.data.caseload, ...me.data.students].find((x) => x.id === id)?.roles ?? []) : []
  const isCm = roles.includes('case_manager')
  const canRate = isCm || roles.includes('teacher') || roles.includes('ea')

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
            <Button onClick={() => setImporting(true)}><FileUp aria-hidden />{s('students.import.open')}</Button>
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
            <GoalCard key={g.id} studentId={id} goal={g} objectives={objs.filter((o) => o.goalId === g.id)} canConfirm={isCm} canRate={canRate} onChanged={bump} />
          ))}
        </section>
      )}

      {timeline.status === 'ready' ? (
        <Timeline studentId={id} dataPoints={timeline.data.dataPoints} decisions={timeline.data.decisions} goals={p.goals} objectives={objs} />
      ) : timeline.status === 'error' ? (
        <Card title={s('students.timeline')}><p role="alert" className="text-small">{timeline.error.message}</p></Card>
      ) : null}

      <WhatWorks studentId={id} />

      <IepImportDialog studentId={id} open={importing} onOpenChange={setImporting} onConfirmed={bump} />
    </div>
  )
}

export default function StudentProfilePage() {
  return (
    <RoleGate path="/students">
      <StudentProfileBody />
    </RoleGate>
  )
}
