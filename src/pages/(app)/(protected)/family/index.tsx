import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
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
  StatusBadge,
  Textarea,
  buttonVariants,
  useToast,
} from '@/components/ui'
import { useDraftsT } from '@/components/drafts/useDraftsT'
import { LANGUAGES } from '@/i18n/languages'
import type { DraftsKey } from '@/i18n/en/drafts'
import {
  ApiError,
  getFamilyProgress,
  getMe,
  getParentInputs,
  sendParentInput,
  setConsent,
  type Consent,
  type FamilyProgress,
  type MeResponse,
  type ParentInput,
} from '@/lib/altamira/drafts-api'

type Student = MeResponse['students'][number]
const KINDS = ['student_mode', 'audio'] as const

export default function FamilyPage() {
  const t = useDraftsT()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [studentId, setStudentId] = useState('')

  useEffect(() => {
    getMe()
      .then((m) => {
        setMe(m)
        const first = m.students.find((s) => s.roles.includes('parent')) ?? m.students[0]
        if (first) setStudentId(first.id)
      })
      .catch(() => setFailed(true))
  }, [])

  const students: Student[] = useMemo(() => {
    if (!me) return []
    const parent = me.students.filter((s) => s.roles.includes('parent') || me.parentOf.includes(s.id))
    return parent.length ? parent : me.students.filter((s) => s.roles.includes('case_manager'))
  }, [me])
  const current = students.find((s) => s.id === studentId) ?? students[0]
  const isParent = !!current && (current.roles.includes('parent') || !!me?.parentOf.includes(current.id))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('drafts.family.title')} description={t('drafts.family.description')} />
      {failed ? (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.family.loadFailed')}
        </p>
      ) : me && !current ? (
        <EmptyState icon={<Users aria-hidden />} title={t('drafts.family.none')} description={t('drafts.family.noneHint')} />
      ) : current ? (
        <>
          {students.length > 1 && (
            <FormField label={t('drafts.family.student')} className="max-w-xs">
              {(c) => (
                <Select value={current.id} onValueChange={setStudentId}>
                  <SelectTrigger id={c.id} aria-label={t('drafts.family.student')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.firstName ?? s.displayToken}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          {isParent ? <ParentView key={current.id} studentId={current.id} /> : <CaseManagerView key={current.id} studentId={current.id} />}
        </>
      ) : null}
    </div>
  )
}

function ParentView({ studentId }: { studentId: string }) {
  const t = useDraftsT()
  const [progress, setProgress] = useState<FamilyProgress | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    getFamilyProgress(studentId)
      .then((p) => live && setProgress(p))
      .catch(() => live && setError(true))
    return () => {
      live = false
    }
  }, [studentId])

  return (
    <>
      <ConsentsCard studentId={studentId} />
      {error && (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.family.loadFailed')}
        </p>
      )}
      {progress && (
        <>
          <Card title={t('drafts.family.summaries')}>
            {progress.summaries.length === 0 ? (
              <p className="text-body text-muted-foreground">{t('drafts.family.noSummaries')}</p>
            ) : (
              progress.summaries.map((s) => (
                <article key={s.id} lang={s.language} className="flex flex-col gap-1">
                  <p className="text-body">{s.text}</p>
                  <p className="text-small text-muted-foreground">
                    {s.language}
                    {s.approvedAt ? `, ${new Date(s.approvedAt).toLocaleDateString()}` : ''}
                  </p>
                </article>
              ))
            )}
          </Card>
          <Card title={t('drafts.family.progress')}>
            {progress.goals.length === 0 ? (
              <p className="text-body text-muted-foreground">{t('drafts.family.noProgress')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {progress.goals.map((g) => (
                  <li key={g.goal.id}>
                    <p className="text-body font-medium">{g.goal.area}</p>
                    <p className="text-body">{g.goal.text}</p>
                    <p className="text-small text-muted-foreground">{t('drafts.family.points', { n: g.dataPoints.length })}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('drafts.family.lessons')}>
            {progress.lessons.length === 0 ? (
              <p className="text-body text-muted-foreground">{t('drafts.family.noLessons')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {progress.lessons.map((l) => (
                  <li key={l.lessonId}>
                    <p className="text-body font-medium">{l.title}</p>
                    <ul className="list-disc pl-5 text-body">
                      {l.adaptations.map((a, i) => (
                        <li key={i}>
                          {a.title}: {a.text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <InputCard studentId={studentId} />
    </>
  )
}

function ConsentsCard({ studentId }: { studentId: string }) {
  const t = useDraftsT()
  const [consents, setConsents] = useState<Consent[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const state = (kind: (typeof KINDS)[number]): boolean | null => {
    if (!consents) return null
    return consents.some((c) => c.kind === kind && !c.revokedAt)
  }
  const toggle = async (kind: (typeof KINDS)[number]) => {
    setBusy(kind)
    setError(false)
    try {
      const r = await setConsent(studentId, { kind, granted: !state(kind) })
      setConsents(r.consents)
    } catch {
      setError(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('drafts.family.consents')}>
      <p className="text-body text-muted-foreground">{t('drafts.family.consentsHint')}</p>
      <ul className="flex flex-col gap-4">
        {KINDS.map((kind) => {
          const on = state(kind)
          return (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">{t(`drafts.family.consent.${kind}` as DraftsKey)}</p>
                <p className="text-small text-muted-foreground">{t(`drafts.family.consent.${kind}.hint` as DraftsKey)}</p>
              </div>
              <StatusBadge tone={on === null ? 'info' : on ? 'success' : 'warning'}>
                {on === null ? t('drafts.family.consentUnknown') : on ? t('drafts.family.consentOn') : t('drafts.family.consentOff')}
              </StatusBadge>
              <Button
                variant="outline"
                role="switch"
                aria-checked={on === true}
                aria-label={t(`drafts.family.consent.${kind}` as DraftsKey)}
                loading={busy === kind}
                disabled={busy !== null}
                onClick={() => toggle(kind)}
              >
                {on ? t('drafts.family.consentOff') : t('drafts.family.consentOn')}
              </Button>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.family.consentFailed')}
        </p>
      )}
    </Card>
  )
}

function InputCard({ studentId }: { studentId: string }) {
  const t = useDraftsT()
  const toast = useToast()
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('en')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendParentInput(studentId, { text: text.trim(), language })
      setText('')
      toast.success(t('drafts.family.sent'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('drafts.family.sendFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title={t('drafts.family.input')}>
      <p className="text-body text-muted-foreground">{t('drafts.family.inputHint')}</p>
      <FormField label={t('drafts.family.inputText')}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      </FormField>
      <FormField label={t('drafts.family.inputLanguage')} className="max-w-xs">
        {(c) => (
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id={c.id} aria-label={t('drafts.family.inputLanguage')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.native}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {error && (
        <p role="alert" className="text-body text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button onClick={send} loading={busy} disabled={!text.trim()}>
          {t('drafts.family.send')}
        </Button>
      </div>
    </Card>
  )
}

function CaseManagerView({ studentId }: { studentId: string }) {
  const t = useDraftsT()
  const [inputs, setInputs] = useState<ParentInput[] | null>(null)
  const [error, setError] = useState(false)
  const load = useCallback(() => {
    getParentInputs(studentId)
      .then((r) => setInputs(r.inputs))
      .catch(() => setError(true))
  }, [studentId])
  useEffect(load, [load])

  return (
    <Card title={t('drafts.family.parentInput')}>
      <p className="text-small text-muted-foreground">{t('drafts.family.cmNote')}</p>
      {error ? (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.family.parentInputFailed')}
        </p>
      ) : inputs && inputs.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('drafts.family.parentInputNone')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {inputs?.map((i) => (
            <li key={i.id} lang={i.language}>
              <p className="text-body">{i.text}</p>
              <p className="text-small text-muted-foreground">
                {i.language}, {new Date(i.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Link to={`/students/${studentId}`} className={buttonVariants({ variant: 'outline' })}>
          {t('drafts.family.openProfile')}
        </Link>
      </div>
    </Card>
  )
}
