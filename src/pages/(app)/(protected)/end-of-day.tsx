import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CircleCheck, ClipboardCheck, FileText } from 'lucide-react'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import { Button, buttonVariants, Card, EmptyState, PageHeader, Progress, StatusBadge, Textarea, useToast } from '@/components/ui'
import { sendNote } from '@/lib/altamyra/capture-api'
import {
  completeDay,
  dayEntries,
  firstOpen,
  getDayReview,
  groupEntries,
  nextStep,
  stepAt,
  stepsFor,
  type DayStudent,
  type EntryGroup,
} from '@/lib/altamyra/eod-api'
import { getDay, type DayDetail } from '@/lib/altamyra/progress-api'
import { approveSummary, saveSummary } from '@/lib/altamyra/summaries-api'
import { localDate } from '@/lib/utils'
import { useLoad } from '@/lib/useLoad'
import { ReviewList } from '@/components/capture/ReviewList'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'

function Retry({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useLang()
  return (
    <Card>
      <p role="alert">{text}</p>
      <div>
        <Button size="lg" onClick={onRetry}>
          {t('capture.common.retry')}
        </Button>
      </div>
    </Card>
  )
}

function EndOfDayBody() {
  const { t } = useLang()
  const date = localDate()
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

  if (failed) return <Retry text={t('eod.loadFailed')} onRetry={load} />
  if (!steps) return <p role="status">{t('eod.loading')}</p>
  if (steps.length === 0)
    return (
      <Card>
        <EmptyState icon={<ClipboardCheck />} title={t('eod.empty')} description={t('eod.emptyBody')} />
      </Card>
    )

  const step = stepAt(index, steps.length)
  const advance = () => setIndex(nextStep(step).index)

  if (step.finished)
    return (
      <Card title={t('eod.finishTitle')}>
        <p role="status" className="flex items-center gap-2">
          <CircleCheck aria-hidden className="size-5" />
          {t('eod.finishBody', { done: done.size, total: steps.length })}
        </p>
        {skipped.size > 0 && <p className="text-muted-foreground">{t('eod.finishSkipped', { n: skipped.size })}</p>}
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
              {t('eod.again')}
            </Button>
          )}
          <Link to="/home" className={buttonVariants({ size: 'lg' })}>
            {t('eod.home')}
          </Link>
        </div>
      </Card>
    )

  const current = steps[step.index]
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="font-semibold">{t('eod.progress', { n: step.index + 1, total: step.total })}</p>
        <Progress value={Math.round((step.index / step.total) * 100)} label={t('eod.progress', { n: step.index + 1, total: step.total })} />
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
  const { t } = useLang()
  const toast = useToast()
  const day = useLoad(() => getDay(student.studentId, date), `${student.studentId}:${date}`)
  const load = day.reload
  const [note, setNote] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)

  async function saveNote() {
    setNoteBusy(true)
    try {
      await sendNote(student.studentId, note)
      toast.success(t('eod.noteSaved'))
      setNote('')
      load()
    } catch {
      toast.error(t('eod.noteFailed'))
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
      toast.error(t('eod.doneFailed'))
      setFinishing(false)
    }
  }

  if (day.status === 'error') return <Retry text={t('eod.stepLoadFailed', { student: student.label })} onRetry={load} />
  if (day.status === 'loading') return <p role="status">{t('eod.loading')}</p>

  const groups = groupEntries(dayEntries(day.data))
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={student.label} />
      <Card title={t('eod.entries')}>
        {groups.length === 0 ? (
          <p className="text-muted-foreground">{t('eod.noEntries', { student: student.label })}</p>
        ) : (
          groups.map((g) => (
            <div key={g.group}>
              <h3 className="font-semibold">{t(`eod.group.${g.group satisfies EntryGroup}` as MessageKey)}</h3>
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
          {t('eod.toConfirm')}
        </h2>
        <ReviewList studentId={student.studentId} onChanged={load} />
      </section>

      <Card title={t('eod.addNote')}>
        <label className="flex flex-col gap-2">
          <span className="font-semibold">{t('eod.noteLabel')}</span>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div>
          <Button variant="secondary" size="lg" disabled={!note.trim()} loading={noteBusy} onClick={saveNote}>
            {t('eod.noteSave')}
          </Button>
        </div>
      </Card>

      <SummaryCard studentId={student.studentId} summary={day.data.dailySummary} onChanged={load} />

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={finish} loading={finishing}>
          {last ? t('eod.doneLast') : t('eod.done')}
        </Button>
        <Button size="lg" variant="ghost" onClick={onSkip} disabled={finishing}>
          {t('eod.skip')}
        </Button>
      </div>
    </div>
  )
}

function SummaryCard({ studentId, summary, onChanged }: { studentId: string; summary: DayDetail['dailySummary']; onChanged: () => void }) {
  const { t } = useLang()
  const toast = useToast()
  const [text, setText] = useState(summary?.text ?? '')
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null)
  useEffect(() => setText(summary?.text ?? ''), [summary?.id, summary?.version, summary?.text])

  if (!summary)
    return (
      <Card title={t('eod.summary')}>
        <p className="text-muted-foreground">{t('eod.summaryNone')}</p>
      </Card>
    )

  const approved = summary.status === 'approved'
  const edited = text.trim() !== summary.text.trim()

  async function run(kind: 'save' | 'approve') {
    if (!summary) return
    setBusy(kind)
    try {
      let version = summary.version
      if (edited) version = (await saveSummary(summary.id, studentId, version, { text: text.trim() })).summary.version
      if (kind === 'approve') await approveSummary(summary.id, studentId, version)
      toast.success(t(kind === 'approve' ? 'eod.summaryApproveDone' : 'eod.summarySaved'))
      onChanged()
    } catch {
      toast.error(t('eod.summaryFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('eod.summary')}>
      <div>
        {approved ? (
          <StatusBadge tone="success">{t('eod.summaryApproved')}</StatusBadge>
        ) : (
          <StatusBadge tone="warning">{t('eod.summaryDraft')}</StatusBadge>
        )}
      </div>
      <label className="flex flex-col gap-2">
        <span className="sr-only">{t('eod.summary')}</span>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-3">
        {edited && (
          <Button variant="secondary" size="lg" loading={busy === 'save'} disabled={!text.trim() || busy !== null} onClick={() => run('save')}>
            <FileText aria-hidden />
            {t('eod.summarySave')}
          </Button>
        )}
        {(!approved || edited) && (
          <Button size="lg" loading={busy === 'approve'} disabled={!text.trim() || busy !== null} onClick={() => run('approve')}>
            {t('eod.summaryApprove')}
          </Button>
        )}
      </div>
    </Card>
  )
}

export default function EndOfDayPage() {
  const { t } = useLang()
  return (
    <RoleGate path="/end-of-day">
      <div className="flex flex-col gap-8">
        <PageHeader title={t('eod.title')} description={t('eod.description')} />
        <EndOfDayBody />
      </div>
    </RoleGate>
  )
}
