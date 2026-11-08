/** School administrator: see who has which role and give someone a role. */
import { useState } from 'react'
import { UsersRound } from 'lucide-react'
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
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { assignRole, listMembers, NEEDS_STUDENT } from '@/lib/altamyra/roles-admin'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import { ALTAMYRA_ROLES, useAltamyraMe, type AltamyraRole } from '@/lib/altamyra/role'
import { useLoad } from '@/lib/useLoad'

const ROLE_KEY: Record<AltamyraRole, MessageKey> = {
  ea: 'app.role.ea',
  teacher: 'app.role.teacher',
  case_manager: 'app.role.case_manager',
  parent: 'app.role.parent',
  district_lead: 'app.role.district_lead',
  school_admin: 'app.role.school_admin',
}

export default function RolesPage() {
  return (
    <RoleGate path="/admin/roles">
      <RolesBody />
    </RoleGate>
  )
}

function RolesBody() {
  const { t } = useLang()
  const toast = useToast()
  const { me, schoolId } = useAltamyraMe()
  const [form, setForm] = useState({ userId: '', displayName: '', role: 'teacher' as AltamyraRole, studentId: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const members = useLoad(() => listMembers(schoolId ?? ''), schoolId)

  const needsStudent = NEEDS_STUDENT.includes(form.role)
  const save = async () => {
    if (!schoolId) return
    if (!form.userId.trim() || !form.displayName.trim()) return setFormError(t('app.roles.needFields'))
    if (needsStudent && !form.studentId.trim()) return setFormError(t('app.roles.needStudent'))
    setSaving(true)
    setFormError(null)
    try {
      await assignRole(schoolId, form)
      toast.success(t('app.roles.saved'))
      setForm((f) => ({ ...f, userId: '', displayName: '', studentId: '' }))
      members.reload()
    } catch (e) {
      setFormError(e instanceof Error && e.message ? e.message : t('app.roles.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const roleLabel = (r: string) => (r in ROLE_KEY ? t(ROLE_KEY[r as AltamyraRole]) : r)

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      <PageHeader title={t('app.roles.title')} description={t('app.roles.description')} />
      {me && !schoolId ? (
        <p role="alert" className="text-body text-destructive">
          {t('app.roles.noSchool')}
        </p>
      ) : (
        <>
          <Card title={t('app.roles.assign')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('app.roles.userId')} hint={t('app.roles.userIdHint')} required>
                <Input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
              </FormField>
              <FormField label={t('app.roles.name')} required>
                <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </FormField>
              <FormField label={t('app.roles.role')} required>
                {(c) => (
                  <Select value={form.role} onValueChange={(v) => v && setForm({ ...form, role: v as AltamyraRole })}>
                    <SelectTrigger id={c.id} aria-label={t('app.roles.role')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALTAMYRA_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(ROLE_KEY[r])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              {needsStudent && (
                <FormField label={t('app.roles.student')} hint={t('app.roles.studentHint')} required>
                  <Input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} />
                </FormField>
              )}
            </div>
            {formError && (
              <p role="alert" className="text-body text-destructive">
                {formError}
              </p>
            )}
            <div>
              <Button onClick={save} loading={saving} disabled={!schoolId}>
                {t('app.roles.save')}
              </Button>
            </div>
          </Card>

          <Card title={t('app.roles.members')}>
            {members.status === 'loading' && (
              <p role="status" className="flex items-center gap-3 text-body text-muted-foreground">
                <Spinner /> {t('app.roles.loading')}
              </p>
            )}
            {members.status === 'error' && (
              <div className="flex flex-col items-start gap-3">
                <p role="alert" className="text-body text-destructive">
                  {t('app.roles.loadFailed')}
                </p>
                <Button variant="outline" onClick={members.reload}>
                  {t('app.roles.retry')}
                </Button>
              </div>
            )}
            {members.data?.length === 0 && (
              <EmptyState icon={<UsersRound aria-hidden />} title={t('app.roles.empty')} description={t('app.roles.emptyHelp')} />
            )}
            {!!members.data?.length && (
              <ul className="flex flex-col gap-3">
                {members.data.map((m, i) => (
                  <li key={`${m.userId}-${m.role}-${m.studentId ?? i}`} className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex flex-col">
                      <span className="text-body font-semibold">{m.displayName ?? m.userId}</span>
                      {m.studentId && <span className="text-small text-muted-foreground">{t('app.roles.forStudent', { student: m.studentId.slice(0, 8) })}</span>}
                    </span>
                    <StatusBadge tone="info">{roleLabel(m.role)}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
