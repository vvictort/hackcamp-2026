import { useEffect, useState } from 'react'
import { CircleCheck, FileText, Printer, TriangleAlert } from 'lucide-react'
import { Button, Card, EmptyState, FormField, Input, StatusBadge, Textarea, useToast } from '@/components/ui'
import { PlanUpload } from '@/components/lens/PlanUpload'
import {
  approvePlan, canApprove, createPlan, editChange, getStudentPlans, pickPlan, PlanConflictError, toggleChange, updatePlan,
  type LessonPlan, type ProposedChange,
} from '@/lib/altamyra/plans-api'
import { ApiError } from '@/lib/altamyra/api'
import { localDate } from '@/lib/utils'
import { useLoad } from '@/lib/useLoad'
import { useLang } from '@/i18n'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card title={title}>{children}</Card>
)
const Text = ({ value }: { value: string }) => <p className="whitespace-pre-wrap text-body">{value}</p>

function Editor({ plan, studentId, onSaved }: { plan: LessonPlan; studentId: string; onSaved: () => void }) {
  const { t } = useLang()
  const toast = useToast()
  const [proposed, setProposed] = useState<ProposedChange[]>(plan.proposed)
  const [tailored, setTailored] = useState(plan.tailoredText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Reset local edits when a newer server version arrives.
  useEffect(() => {
    setProposed(plan.proposed)
    setTailored(plan.tailoredText)
  }, [plan.id, plan.version])

  const run = async (approve: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const dirty = tailored !== plan.tailoredText || JSON.stringify(proposed) !== JSON.stringify(plan.proposed)
      let version = plan.version
      if (dirty) version = (await updatePlan(plan.id, studentId, version, { proposed, tailoredText: tailored })).plan.version
      if (approve) {
        await approvePlan(plan.id, studentId, version)
        toast.success(t('plan.approved.toast'))
      } else toast.success(t('plan.saved'))
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('plan.conflict') : t('plan.error'))
      if (e instanceof ApiError && e.status === 409) onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section title={t('plan.original')}><Text value={plan.originalText} /></Section>
      <Section title={t('plan.proposed')}>
        {proposed.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('plan.proposed.none')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {proposed.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-label font-semibold">
                  <input type="checkbox" className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={c.accepted} onChange={() => setProposed((l) => toggleChange(l, c.id))} />
                  {t('plan.proposed.accept')}
                  {c.label && <span className="font-normal text-muted-foreground">- {c.label}</span>}
                </label>
                <Textarea aria-label={t('plan.proposed.edit')} rows={2} value={c.text} onChange={(e) => setProposed((l) => editChange(l, c.id, e.target.value))} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t('plan.tailored')}>
        <Textarea aria-label={t('plan.tailored.edit')} rows={10} value={tailored} onChange={(e) => setTailored(e.target.value)} />
      </Section>
      {error && <p role="alert" className="text-small text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void run(true)} loading={busy} disabled={busy || !canApprove({ status: plan.status, tailoredText: tailored })}>
          <CircleCheck aria-hidden />
          {busy ? t('plan.approving') : t('plan.approve')}
        </Button>
        <Button variant="outline" onClick={() => void run(false)} disabled={busy}>{t('plan.saveEdits')}</Button>
      </div>
    </>
  )
}

function ReadOnly({ plan }: { plan: LessonPlan }) {
  const { t } = useLang()
  const used = plan.proposed.filter((c) => c.accepted)
  return (
    <>
      <Section title={t('plan.original')}><Text value={plan.originalText} /></Section>
      <Section title={t('plan.proposed')}>
        {used.length === 0 ? (
          <p className="text-small text-muted-foreground">{t('plan.proposed.none')}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-2 pl-5 text-body">{used.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
        )}
      </Section>
      <Section title={t('plan.tailored')}><Text value={plan.tailoredText} /></Section>
      <div><Button variant="outline" onClick={() => window.print()}><Printer aria-hidden />{t('plan.print')}</Button></div>
    </>
  )
}

/** Lesson plan tab: teacher adds, edits and approves; EA and case manager read the approved plan. */
export function PlanTab({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const { t } = useLang()
  const [date, setDate] = useState(localDate())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const load = useLoad(() => getStudentPlans(studentId, date), `${studentId}:${date}`)

  const plan = load.status === 'ready' ? pickPlan(load.data.plans) : null
  const visible = plan && (canEdit || plan.status === 'approved') ? plan : null

  const add = async (v: { title: string; text: string }) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await createPlan(studentId, { ...v, date })
      load.reload()
    } catch (e) {
      if (e instanceof PlanConflictError) {
        // Plan already exists: say so plainly and switch to it.
        setNotice(e.message)
        load.reload()
      } else setError(t('plan.add.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <FormField label={t('plan.date')} className="w-44">
          <Input type="date" value={date} onChange={(e) => e.target.value && (setNotice(null), setDate(e.target.value))} />
        </FormField>
        {visible && (
          <div className="pb-1.5">
            {visible.status === 'approved' ? (
              <StatusBadge tone="success">{t('plan.status.approved')}</StatusBadge>
            ) : (
              <StatusBadge tone="warning">{t('plan.status.draft')}</StatusBadge>
            )}
          </div>
        )}
      </div>
      {load.status === 'loading' && <p role="status" className="text-muted-foreground">{t('plan.loading')}</p>}
      {load.status === 'error' && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="flex items-center gap-2"><TriangleAlert className="size-5" aria-hidden />{load.error.message}</p>
          <Button variant="outline" className="self-start" onClick={load.reload}>{t('students.retry')}</Button>
        </div>
      )}
      {load.status === 'ready' && !visible && (canEdit ? (
        <>
          <p className="text-body text-muted-foreground">{t('plan.empty.teacher')}</p>
          <PlanUpload busy={busy} error={error} onSubmit={(v) => void add(v)} />
        </>
      ) : (
        <Card>
          <EmptyState icon={<FileText aria-hidden />} title={t(date === localDate() ? 'plan.empty.ea' : 'plan.empty.date')} />
        </Card>
      ))}
      {notice && visible && <p role="status" className="text-small text-muted-foreground">{notice}</p>}
      {load.status === 'ready' && visible && (canEdit ? <Editor plan={visible} studentId={studentId} onSaved={load.reload} /> : <ReadOnly plan={visible} />)}
    </div>
  )
}
