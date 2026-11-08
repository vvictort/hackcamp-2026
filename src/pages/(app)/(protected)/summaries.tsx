/**
 * Summaries: daily, weekly and monthly. Teacher and EA pick a student, read the
 * AI draft, fix it and approve it; nothing reaches its audience before that.
 * The case manager only reads approved weekly summaries.
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { FileText } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  FormField,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui'
import { useLang } from '@/i18n'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import { useAltamyraMe, visibleStudents } from '@/lib/altamyra/role'
import { LoadError, useLoad } from '@/lib/useLoad'
import { studentLabel } from '@/components/capture/StudentSelect'
import {
  approveSummary,
  AUDIENCE_KEY,
  generateSummary,
  listSummaries,
  listWeekly,
  pickCurrent,
  saveSummary,
  SUMMARY_KINDS,
  type Summary,
  type SummaryKind,
} from '@/lib/altamyra/summaries-api'

export default function SummariesPage() {
  return (
    <RoleGate path="/summaries">
      <SummariesBody />
    </RoleGate>
  )
}

function SummariesBody() {
  const { t } = useLang()
  const { role } = useAltamyraMe()
  const cm = role === 'case_manager'
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('app.summaries.title')} description={cm ? t('app.summaries.cmDescription') : t('app.summaries.description')} />
      {cm ? <WeeklyReadOnly /> : <StaffSummaries />}
    </div>
  )
}

function Loading() {
  const { t } = useLang()
  return (
    <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
      <Spinner /> {t('app.summaries.loading')}
    </p>
  )
}

function WeeklyReadOnly() {
  const { t } = useLang()
  const weekly = useLoad(listWeekly, 'weekly')
  const rows = weekly.data

  if (weekly.status === 'error') return <LoadError error={weekly.error} onRetry={weekly.reload} />
  if (!rows) return <Loading />
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState className="py-10" icon={<FileText aria-hidden />} title={t('app.summaries.cmEmpty')} description={t('app.summaries.cmEmptyBody')} />
      </Card>
    )
  return (
    <div className="flex flex-col gap-6">
      {rows.map((s) => (
        <Card key={s.id} title={t('app.summaries.period', { period: s.period })}>
          <StatusBadge tone="success">{t('app.summaries.readOnly')}</StatusBadge>
          <p className="whitespace-pre-line text-body">{s.text}</p>
        </Card>
      ))}
    </div>
  )
}

function StaffSummaries() {
  const { t } = useLang()
  const { me } = useAltamyraMe()
  const [params, setParams] = useSearchParams()
  const students = visibleStudents(me)
  const kindParam = params.get('kind') as SummaryKind | null
  const kind: SummaryKind = kindParam && SUMMARY_KINDS.includes(kindParam) ? kindParam : 'daily'
  const studentId = students.find((s) => s.id === params.get('student'))?.id ?? students[0]?.id ?? ''
  const update = (next: { kind?: SummaryKind; student?: string }) => {
    const p = new URLSearchParams(params)
    p.set('kind', next.kind ?? kind)
    p.set('student', next.student ?? studentId)
    p.delete('id')
    setParams(p, { replace: true })
  }

  if (!me) return <Loading />
  if (students.length === 0)
    return (
      <Card>
        <EmptyState className="py-10" icon={<FileText aria-hidden />} title={t('app.summaries.noStudents')} />
      </Card>
    )

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" aria-label={t('app.summaries.title')} className="flex flex-wrap gap-2">
          {SUMMARY_KINDS.map((k) => (
            <Button key={k} role="tab" aria-selected={k === kind} variant={k === kind ? 'default' : 'outline'} onClick={() => update({ kind: k })}>
              {t(`app.summaries.kind.${k}`)}
            </Button>
          ))}
        </div>
        {students.length > 1 && (
          <FormField label={t('app.summaries.student')} className="w-full sm:w-56">
            {(c) => (
              <Select value={studentId} onValueChange={(v) => v && update({ student: v })}>
                <SelectTrigger id={c.id} aria-label={t('app.summaries.student')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {studentLabel(s, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        )}
      </div>
      <p className="text-body text-muted-foreground">{t(AUDIENCE_KEY[kind])}</p>
      <SummaryEditor key={`${studentId}-${kind}`} studentId={studentId} kind={kind} />
    </>
  )
}

function SummaryEditor({ studentId, kind }: { studentId: string; kind: SummaryKind }) {
  const current = useLoad(async () => pickCurrent(await listSummaries(studentId, kind)), `${studentId}:${kind}`)
  if (current.status === 'error') return <LoadError error={current.error} onRetry={current.reload} />
  if (current.status === 'loading') return <Loading />
  return <SummaryForm studentId={studentId} kind={kind} initial={current.data} />
}

function SummaryForm({ studentId, kind, initial }: { studentId: string; kind: SummaryKind; initial: Summary | null }) {
  const { t } = useLang()
  const toast = useToast()
  const [summary, setSummary] = useState(initial)
  const [text, setText] = useState(initial?.text ?? '')
  const [translated, setTranslated] = useState(initial?.translatedText ?? '')
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'approve'>(null)

  const adopt = (s: Summary | null) => {
    setSummary(s)
    setText(s?.text ?? '')
    setTranslated(s?.translatedText ?? '')
  }

  const generate = async () => {
    setBusy('generate')
    try {
      adopt((await generateSummary(studentId, kind)).summary)
      toast.success(t('app.summaries.generated'))
    } catch {
      toast.error(t('app.summaries.generateFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (!summary)
    return (
      <Card>
        <EmptyState
          className="py-10"
          icon={<FileText aria-hidden />}
          title={t('app.summaries.none')}
          description={t('app.summaries.noneBody')}
          action={{ label: busy ? t('app.summaries.loading') : t('app.summaries.generate'), onClick: () => void generate() }}
        />
      </Card>
    )

  const monthly = kind === 'monthly'
  const dirty = text !== summary.text || (monthly && translated !== (summary.translatedText ?? ''))
  const body = () => (monthly ? { text, translatedText: translated } : { text })
  const save = async () => {
    setBusy('save')
    try {
      adopt((await saveSummary(summary.id, studentId, summary.version, body())).summary)
      toast.success(t('app.summaries.saved'))
    } catch {
      toast.error(t('app.summaries.saveFailed'))
    } finally {
      setBusy(null)
    }
  }
  const approve = async () => {
    setBusy('approve')
    try {
      const current = dirty ? (await saveSummary(summary.id, studentId, summary.version, body())).summary : summary
      adopt((await approveSummary(current.id, studentId, current.version)).summary)
      toast.success(t('app.summaries.approved'))
    } catch {
      toast.error(t('app.summaries.approveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const draft = summary.status === 'draft'
  return (
    <Card title={t('app.summaries.period', { period: summary.period })}>
      {draft ? <StatusBadge tone="warning">{t('app.summaries.draft')}</StatusBadge> : <StatusBadge tone="success">{t('app.summaries.approvedBadge')}</StatusBadge>}
      {draft && <p className="text-small text-muted-foreground">{t('app.summaries.aiNote')}</p>}
      <FormField label={t('app.summaries.text')}>
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      </FormField>
      {monthly && (
        <FormField label={t('app.summaries.translated')} hint={t('app.summaries.translatedHint')}>
          <Textarea rows={8} lang={summary.language ?? undefined} value={translated} onChange={(e) => setTranslated(e.target.value)} />
        </FormField>
      )}
      <div className="flex flex-wrap gap-3">
        {draft && (
          <Button onClick={() => void approve()} loading={busy === 'approve'} disabled={busy !== null || !text.trim()}>
            {t('app.summaries.approve')}
          </Button>
        )}
        <Button variant="outline" onClick={() => void save()} loading={busy === 'save'} disabled={busy !== null || !dirty || !text.trim()}>
          {t('app.summaries.save')}
        </Button>
      </div>
    </Card>
  )
}
