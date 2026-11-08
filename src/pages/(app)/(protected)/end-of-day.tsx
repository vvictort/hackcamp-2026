import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck, ClipboardCheck, FileText } from 'lucide-react'
import { RoleGate } from '@/lib/altamira/RoleGate'
import { Button, buttonVariants, Card, EmptyState, PageHeader, Progress, StatusBadge, Textarea, useToast } from '@/components/ui'
import { sendNote } from '@/lib/altamira/capture-api'
import {
  approveSummary,
  completeDay,
  dayEntries,
  editSummary,
  firstOpen,
  getDay,
  getDayReview,
  groupEntries,
  nextStep,
  stepAt,
  stepsFor,
  todayLocal,
  type DayRecord,
  type DayStudent,
  type EntryGroup,
} from '@/lib/altamira/eod-api'
import { ReviewList } from '@/components/capture/ReviewList'
import { useCt, type CaptureKey } from '@/components/capture/useCt'

function Retry({ text, onRetry }: { text: string; onRetry: () => void }) {
  const ct = useCt()
  return (
    <Card>
      <p role="alert">{text}</p>
      <div>
        <Button size="lg" onClick={onRetry}>
          {ct('capture.common.retry')}
        </Button>
      </div>
    </Card>
  )
}

function EndOfDayBody() {
  const ct = useCt()
  const date = todayLocal()
  const [steps, setSteps] = useState<DayStudent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setFailed(false)
    getDayReview()
      .then((r) => {
        const list = stepsFor(r.students)
        setSteps(list)
        setIndex(firstOpen(list))
        setDone(new Set(list.filter((s) => s.reviewed).map((s) => s.studentId)))
        setSkipped(new Set())
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  if (failed) return <Retry text={ct('eod.loadFailed')} onRetry={load} />
  if (!steps) return <p role="status">{ct('eod.loading')}</p>
  if (steps.length === 0)
    return (
      <Card>
        <EmptyState icon={<ClipboardCheck />} title={ct('eod.empty')} description={ct('eod.emptyBody')} />
      </Card>
    )

  const step = stepAt(index, steps.length)
  const advance = () => setIndex(nextStep(step).index)

  if (step.finished)
    return (
      <Card title={ct('eod.finishTitle')}>
        <p role="status" className="flex items-center gap-2">
          <CircleCheck aria-hidden className="size-5" />
          {ct('eod.finishBody', { done: done.size, total: steps.length })}
        </p>
        {skipped.size > 0 && <p className="text-muted-foreground">{ct('eod.finishSkipped', { n: skipped.size })}</p>}
        <div className="flex flex-wrap gap-3">
          {skipped.size > 0 && (
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                const i = steps.findIndex((s) => skipped.has(s.studentId))
                setSkipped(new Set())
                setIndex(Math.max(i, 0))
              }}
            >
              {ct('eod.again')}
            </Button>
          )}
          <Link to="/home" className={buttonVariants({ size: 'lg' })}>
            {ct('eod.home')}
          </Link>
        </div>
      </Card>
    )

  const current = steps[step.index]
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="font-semibold">{ct('eod.progress', { n: step.index + 1, total: step.total })}</p>
        <Progress value={Math.round((step.index / step.total) * 100)} label={ct('eod.progress', { n: step.index + 1, total: step.total })} />
      </div>
      <ChildStep
        key={current.studentId}
        student={current}
        date={date}
        last={step.index === step.total - 1}
        onDone={() => {
          setDone((d) => new Set(d).add(current.studentId))
          setSkipped((s) => {
            const n = new Set(s)
            n.delete(current.studentId)
            return n
          })
          advance()
        }}
        onSkip={() => {
          setSkipped((s) => new Set(s).add(current.studentId))
          advance()
        }}
      />
    </div>
  )
}

function ChildStep({ student, date, last, onDone, onSkip }: { student: DayStudent; date: string; last: boolean; onDone: () => void; onSkip: () => void }) {
  const ct = useCt()
  const toast = useToast()
  const [day, setDay] = useState<DayRecord | null>(null)
  const [failed, setFailed] = useState(false)
  const [note, setNote] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    getDay(student.studentId, date)
      .then(setDay)
      .catch(() => setFailed(true))
  }, [student.studentId, date])
  useEffect(load, [load])

  async function saveNote() {
    setNoteBusy(true)
    try {
      await sendNote(student.studentId, note)
      toast.success(ct('eod.noteSaved'))
      setNote('')
      load()
    } catch {
      toast.error(ct('eod.noteFailed'))
    } finally {
      setNoteBusy(false)
    }
  }

  async function finish() {
    setFinishing(true)
    try {
      await completeDay(student.studentId, date)
      onDone()
    } catch {
      toast.error(ct('eod.doneFailed'))
      setFinishing(false)
    }
  }

  if (failed) return <Retry text={ct('eod.stepLoadFailed', { student: student.label })} onRetry={load} />
  if (!day) return <p role="status">{ct('eod.loading')}</p>

  const groups = groupEntries(dayEntries(day))
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={student.label} />
      <Card title={ct('eod.entries')}>
        {groups.length === 0 ? (
          <p className="text-muted-foreground">{ct('eod.noEntries', { student: student.label })}</p>
        ) : (
          groups.map((g) => (
            <div key={g.group}>
              <h3 className="font-semibold">{ct(`eod.group.${g.group satisfies EntryGroup}` as CaptureKey)}</h3>
              <ul className="list-disc pl-6">
                {g.lines.map((l) => (
                  <li key={l.key}>{l.text}</li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Card>

      <section aria-labelledby="eod-confirm" className="flex flex-col gap-3">
        <h2 id="eod-confirm" className="text-h2 font-extrabold">
          {ct('eod.toConfirm')}
        </h2>
        <ReviewList studentId={student.studentId} onChanged={load} />
      </section>

      <Card title={ct('eod.addNote')}>
        <label className="flex flex-col gap-2">
          <span className="font-semibold">{ct('eod.noteLabel')}</span>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div>
          <Button variant="secondary" size="lg" disabled={!note.trim()} loading={noteBusy} onClick={saveNote}>
            {ct('eod.noteSave')}
          </Button>
        </div>
      </Card>

      <SummaryCard studentId={student.studentId} summary={day.dailySummary} onChanged={load} />

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={finish} loading={finishing}>
          {last ? ct('eod.doneLast') : ct('eod.done')}
        </Button>
        <Button size="lg" variant="ghost" onClick={onSkip} disabled={finishing}>
          {ct('eod.skip')}
        </Button>
      </div>
    </div>
  )
}

function SummaryCard({ studentId, summary, onChanged }: { studentId: string; summary: DayRecord['dailySummary']; onChanged: () => void }) {
  const ct = useCt()
  const toast = useToast()
  const [text, setText] = useState(summary?.text ?? '')
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null)
  useEffect(() => setText(summary?.text ?? ''), [summary?.id, summary?.version, summary?.text])

  if (!summary)
    return (
      <Card title={ct('eod.summary')}>
        <p className="text-muted-foreground">{ct('eod.summaryNone')}</p>
      </Card>
    )

  const approved = summary.status === 'approved'
  const edited = text.trim() !== summary.text.trim()

  async function run(kind: 'save' | 'approve') {
    if (!summary) return
    setBusy(kind)
    try {
      let version = summary.version
      if (edited) version = (await editSummary(summary.id, studentId, version, text.trim())).summary.version
      if (kind === 'approve') await approveSummary(summary.id, studentId, version)
      toast.success(ct(kind === 'approve' ? 'eod.summaryApproveDone' : 'eod.summarySaved'))
      onChanged()
    } catch {
      toast.error(ct('eod.summaryFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={ct('eod.summary')}>
      <div>
        {approved ? (
          <StatusBadge tone="success">{ct('eod.summaryApproved')}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{ct('eod.summaryDraft')}</StatusBadge>
        )}
      </div>
      <label className="flex flex-col gap-2">
        <span className="sr-only">{ct('eod.summary')}</span>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-3">
        {edited && (
          <Button variant="secondary" size="lg" loading={busy === 'save'} disabled={!text.trim() || busy !== null} onClick={() => run('save')}>
            <FileText aria-hidden />
            {ct('eod.summarySave')}
          </Button>
        )}
        {(!approved || edited) && (
          <Button size="lg" loading={busy === 'approve'} disabled={!text.trim() || busy !== null} onClick={() => run('approve')}>
            {ct('eod.summaryApprove')}
          </Button>
        )}
      </div>
    </Card>
  )
}

export default function EndOfDayPage() {
  const ct = useCt()
  return (
    <RoleGate path="/end-of-day">
      <div className="flex flex-col gap-8">
        <PageHeader title={ct('eod.title')} description={ct('eod.description')} />
        <EndOfDayBody />
      </div>
    </RoleGate>
  )
}
