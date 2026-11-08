import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { DraftCard } from '@/components/drafts/DraftCard'
import { TodayLinkCard } from '@/components/drafts/TodayLinkCard'
import { useDraftsT } from '@/components/drafts/useDraftsT'
import {
  ApiError,
  createDraft,
  getMe,
  getProfile,
  type MeResponse,
  type ProgressDraft,
} from '@/lib/altamira/drafts-api'

interface GoalOption {
  id: string
  area: string
  text: string
}

export default function DraftsPage() {
  const t = useDraftsT()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [goals, setGoals] = useState<GoalOption[]>([])
  const [goalId, setGoalId] = useState('')
  const [period, setPeriod] = useState('Term 1')
  const [drafts, setDrafts] = useState<ProgressDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMe().then(setMe).catch(() => setLoadError(true))
  }, [])

  const students = useMemo(() => me?.students ?? [], [me])

  useEffect(() => {
    setGoals([])
    setGoalId('')
    if (!studentId) return
    let live = true
    getProfile(studentId)
      .then((p) => {
        if (!live) return
        const g = p.view === 'full' ? p.goals.map((x) => ({ id: x.id, area: x.area, text: x.text })) : []
        setGoals(g)
        if (g[0]) setGoalId(g[0].id)
      })
      .catch(() => live && setGoals([]))
    return () => {
      live = false
    }
  }, [studentId])

  const label = (s: MeResponse['students'][number]) => s.firstName ?? s.displayToken
  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const { draft } = await createDraft(studentId, { goalId, period: period.trim() })
      setDrafts((d) => [draft, ...d])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('drafts.generateFailed'))
    } finally {
      setBusy(false)
    }
  }
  const replace = (d: ProgressDraft) => setDrafts((all) => all.map((x) => (x.id === d.id ? d : x)))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('drafts.title')} description={t('drafts.description')} />
      {loadError ? (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.loadFailed')}
        </p>
      ) : me && students.length === 0 ? (
        <EmptyState icon={<FileText aria-hidden />} title={t('drafts.noStudents')} description={t('drafts.noStudentsHint')} />
      ) : (
        <>
          <Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label={t('drafts.student')}>
                {(c) => (
                  <Select value={studentId} onValueChange={setStudentId}>
                    <SelectTrigger id={c.id} aria-label={t('drafts.student')}>
                      <SelectValue placeholder={t('drafts.studentPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {students.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {label(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label={t('drafts.goal')} error={studentId && goals.length === 0 ? t('drafts.noGoals') : undefined}>
                {(c) => (
                  <Select value={goalId} onValueChange={setGoalId} disabled={goals.length === 0}>
                    <SelectTrigger id={c.id} aria-label={t('drafts.goal')}>
                      <SelectValue placeholder={t('drafts.goalPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {goals.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.area}: {g.text.slice(0, 60)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label={t('drafts.period')}>
                <Input value={period} onChange={(e) => setPeriod(e.target.value)} />
              </FormField>
            </div>
            <div>
              <Button onClick={generate} loading={busy} disabled={!studentId || !goalId || !period.trim()}>
                {busy ? t('drafts.generating') : t('drafts.generate')}
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-body text-destructive">
                {error}
              </p>
            )}
          </Card>
          {drafts.length === 0 ? (
            <EmptyState icon={<FileText aria-hidden />} title={t('drafts.empty')} description={t('drafts.emptyHint')} />
          ) : (
            drafts.map((d) => <DraftCard key={d.id} draft={d} studentId={studentId} goalText={goals.find((g) => g.id === d.goalId)?.text} onChange={replace} />)
          )}
          {studentId && <TodayLinkCard studentId={studentId} />}
        </>
      )}
    </div>
  )
}
