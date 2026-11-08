/**
 * Settings (gated): (protected)/_layout.tsx already wraps this in <AuthGate>.
 * Profile (school, position) and preferences live on the user's own `users`
 * record (see src/schemas/users-schema.ts); a person can only read and edit
 * their own row.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { useMutations, useQuery, useUser } from 'deepspace'
import { MonitorSmartphone } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'
import { SessionsPanel } from '@/components/SessionsPanel'
import { endSession } from '@/lib/session'
import { POSITIONS, POSITION_LABELS } from '@/lib/positions'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { initialOf } from '@/lib/utils'

interface Profile {
  school?: string
  position?: string
  language?: string
  pulseReminder?: string
}

const SECTIONS = [
  { id: 'profile', label: 'app.settings.profile' },
  { id: 'school', label: 'app.settings.school' },
  { id: 'prefs', label: 'app.settings.prefs' },
  { id: 'devices', label: 'app.settings.devices' },
  { id: 'a11y', label: 'app.settings.a11y' },
] as const satisfies readonly { id: string; label: MessageKey }[]
type Section = (typeof SECTIONS)[number]['id']

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label font-semibold text-muted-foreground">{label}</dt>
      <dd className="break-words text-body">{value}</dd>
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useUser()
  const { success, error } = useToast()
  const { t, lang, setLang } = useLang()
  const { records } = useQuery<Profile>('users')
  const { put, ready } = useMutations<Profile>('users')
  // Admins can read every users row, so pick this person's own (recordId is the user id).
  const me = records.find((r) => r.recordId === user?.id)

  const [section, setSection] = useState<Section>('profile')
  const [school, setSchool] = useState('')
  const [position, setPosition] = useState('')
  const [pulseReminder, setPulseReminder] = useState(true)
  const [saving, setSaving] = useState(false)

  const recordId = me?.recordId
  useEffect(() => {
    const d = me?.data
  // Stored value stays English; only the display label is translated.
  const positionLabel = (p: string) => (p in POSITION_LABELS ? t(POSITION_LABELS[p as keyof typeof POSITION_LABELS]) : p)
    if (!d) return
    setSchool(d.school ?? '')
    setPosition(d.position ?? '')
    if (d.language) setLang(d.language)
    setPulseReminder(d.pulseReminder !== 'off')
    // Load once per record; later edits stay local until saved.
  }, [recordId])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!recordId) return
    setSaving(true)
    try {
      await put(recordId, { school: school.trim(), position, language: lang, pulseReminder: pulseReminder ? 'on' : 'off' })
      success(t('app.settings.saved'), t('app.settings.savedBody'))
    } catch {
      error(t('app.settings.saveFailed'), t('app.settings.saveFailedBody'))
    } finally {
      setSaving(false)
    }
  }

  const d = me?.data
  // Stored value stays English; only the display label is translated.
  const positionLabel = (p: string) => (p in POSITION_LABELS ? t(POSITION_LABELS[p as keyof typeof POSITION_LABELS]) : p)
  const role = user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : t('app.settings.notSet')
  const current = SECTIONS.find((s) => s.id === section)!
  // Drafts live on this page, so switching sections keeps unsaved edits; either form's Save sends all of them.
  const saveButton = (
    <Button type="submit" className="self-end" loading={saving} disabled={!ready || !recordId}>
      {t('common.save')}
    </Button>
  )

  return (
    <div className="flex w-full flex-col gap-6 lg:gap-8">
      <PageHeader title={t('settings.title')} description={t('app.settings.description')} />

      <div className="stagger-rise grid grid-cols-1 items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-5">
        <nav aria-label={t('app.settings.sections')} className="min-w-0">
          <ul className="-m-1 flex gap-2 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <Button
                  variant={s.id === section ? 'default' : 'ghost'}
                  aria-current={s.id === section ? 'true' : undefined}
                  aria-controls="settings-panel"
                  className="px-5 max-lg:shadow-none lg:w-full lg:justify-start"
                  onClick={() => setSection(s.id)}
                >
                  {t(s.label)}
                </Button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {/* Keyed by section: a switch re-mounts the panel so it rises in again. */}
          <Card key={section} id="settings-panel" title={t(current.label)} className="animate-rise">
            {section === 'profile' && (
              <>
                <div className="flex items-center gap-4">
                  <Avatar aria-hidden className="size-12">
                    <AvatarImage src={user?.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                    <AvatarFallback className="bg-primary text-h2 font-bold text-primary-foreground">
                      {initialOf(user)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-h3 font-bold">{user?.name || t('app.settings.notSet')}</p>
                    <p className="truncate text-body text-muted-foreground">
                      {d?.position && d?.school
                        ? t('app.settings.at', { position: positionLabel(d.position), school: d.school })
                        : [d?.position && positionLabel(d.position), d?.school].filter(Boolean).join('') || t('app.settings.addSchool')}
                    </p>
                  </div>
                </div>
                <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                  <Field label={t('app.settings.email')} value={user?.email ?? t('app.settings.notSet')} />
                  <Field label={t('app.settings.accessLevel')} value={role} />
                </dl>
                <Button variant="secondary" className="self-start" onClick={() => endSession()}>
                  {t('common.signOut')}
                </Button>
              </>
            )}

            {section === 'school' && (
              <form onSubmit={save} className="flex flex-col gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="school">{t('app.settings.schoolLabel')}</Label>
                    <Input id="school" value={school} maxLength={120} onChange={(e) => setSchool(e.target.value)} placeholder={t('app.settings.schoolPlaceholder')} autoComplete="organization" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="position">{t('app.settings.position')}</Label>
                    <Select value={position} onValueChange={setPosition}>
                      <SelectTrigger id="position">
                        <SelectValue placeholder={t('app.settings.positionPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map((p) => (
                          <SelectItem key={p} value={p}>{t(POSITION_LABELS[p])}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {saveButton}
              </form>
            )}

            {section === 'prefs' && (
              <form onSubmit={save} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 md:max-w-sm">
                  <span className="text-label font-semibold">{t('common.language')}</span>
                  <LanguageSwitcher className="h-11 w-full justify-between gap-2 rounded-md" />
                  <span className="text-small text-muted-foreground">{t('settings.language.hint')}</span>
                </div>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-body">
                  <input
                    type="checkbox"
                    checked={pulseReminder}
                    onChange={(e) => setPulseReminder(e.target.checked)}
                    className="mt-1 size-5 shrink-0 cursor-pointer accent-foreground"
                  />
                  <span>
                    {t('app.settings.pulseReminder')}
                    <span className="block text-small text-muted-foreground">{t('app.settings.pulseReminderHint')}</span>
                  </span>
                </label>
                {saveButton}
              </form>
            )}

            {section === 'devices' && <SessionsPanel />}
            {section === 'a11y' && (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <MonitorSmartphone className="size-6" aria-hidden />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-h3 font-bold">{t('app.settings.textSize')}</h3>
                  <p className="max-w-[60ch] text-body text-muted-foreground">
                    {t('app.settings.textSizeBody')}
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
