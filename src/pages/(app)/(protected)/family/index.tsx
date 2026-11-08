/** Parent view: the approved monthly update (with audio) and consent toggles for the parent's own child. */
import { useMemo, useState } from 'react'
import { FileText, Users } from 'lucide-react'
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
} from '@/components/ui'
import { ReadAloudButton } from '@/components/ReadAloudButton'
import { useLang } from '@/i18n'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import { useAltamyraMe } from '@/lib/altamyra/role'
import { useLoad } from '@/lib/useLoad'
import { studentLabel } from '@/components/capture/StudentSelect'
import {
  FAMILY_CONSENT_KINDS,
  familyText,
  getFamilySummaries,
  setConsent,
  type Consent,
  type FamilyConsentKind,
  type FamilySummary,
} from '@/lib/altamyra/family-api'

export default function FamilyPage() {
  return (
    <RoleGate path="/family">
      <FamilyBody />
    </RoleGate>
  )
}

function FamilyBody() {
  const { t } = useLang()
  const { me, loading } = useAltamyraMe()
  const failed = !loading && !me
  const [studentId, setStudentId] = useState('')

  const students = useMemo(() => (me ? me.students.filter((s) => me.parentOf.includes(s.id) || s.roles.includes('parent')) : []), [me])
  const current = students.find((s) => s.id === studentId) ?? students[0]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('drafts.family.title')} description={t('drafts.family.description')} />
      {failed ? (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.family.loadFailed')}
        </p>
      ) : !me ? (
        <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
          <Spinner /> {t('drafts.family.loading')}
        </p>
      ) : !current ? (
        <EmptyState icon={<Users aria-hidden />} title={t('drafts.family.none')} description={t('drafts.family.noneHint')} />
      ) : (
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
                        {studentLabel(s, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          <ParentView key={current.id} studentId={current.id} />
        </>
      )}
    </div>
  )
}

function ParentView({ studentId }: { studentId: string }) {
  const { t } = useLang()
  const summaries = useLoad(() => getFamilySummaries(studentId), studentId)
  const rows = summaries.data

  const [latest, ...earlier] = rows ?? []

  return (
    <>
      {summaries.status === 'error' ? (
        <p role="alert" className="text-body text-destructive">
          {t('drafts.family.loadFailed')}
        </p>
      ) : !rows ? (
        <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
          <Spinner /> {t('drafts.family.loading')}
        </p>
      ) : !latest ? (
        <Card>
          <EmptyState className="py-10" icon={<FileText aria-hidden />} title={t('app.family.empty')} />
        </Card>
      ) : (
        <>
          <Card title={t('app.family.latest')}>
            <SummaryText s={latest} studentId={studentId} />
          </Card>
          {earlier.length > 0 && (
            <Card title={t('app.family.earlier')}>
              <ul className="flex flex-col gap-3">
                {earlier.map((s) => (
                  <li key={s.id}>
                    <details>
                      <summary className="cursor-pointer text-label font-semibold">{t('app.family.month', { period: s.period })}</summary>
                      <div className="mt-3">
                        <SummaryText s={s} studentId={studentId} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <ConsentsCard studentId={studentId} />
    </>
  )
}

function SummaryText({ s, studentId }: { s: FamilySummary; studentId: string }) {
  const { t } = useLang()
  const { text, lang } = familyText(s)
  return (
    <article lang={lang} className="flex flex-col gap-3">
      <p className="text-small text-muted-foreground">{t('app.family.month', { period: s.period })}</p>
      <p className="whitespace-pre-line text-body">{text}</p>
      <ReadAloudButton text={text} lang={lang} studentId={studentId} className="self-start" />
    </article>
  )
}

function ConsentsCard({ studentId }: { studentId: string }) {
  const { t } = useLang()
  const [consents, setConsents] = useState<Consent[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const state = (kind: FamilyConsentKind): boolean | null => (consents ? consents.some((c) => c.kind === kind && !c.revokedAt) : null)
  const toggle = async (kind: FamilyConsentKind) => {
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
        {FAMILY_CONSENT_KINDS.map((kind) => {
          const on = state(kind)
          const label = t(`drafts.family.consent.${kind}`)
          return (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">{label}</p>
                <p className="text-small text-muted-foreground">{t(`drafts.family.consent.${kind}.hint`)}</p>
              </div>
              <StatusBadge tone={on === null ? 'info' : on ? 'success' : 'warning'}>
                {on === null ? t('drafts.family.consentUnknown') : on ? t('drafts.family.consentOn') : t('drafts.family.consentOff')}
              </StatusBadge>
              <Button
                variant="outline"
                role="switch"
                aria-checked={on === true}
                aria-label={label}
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
