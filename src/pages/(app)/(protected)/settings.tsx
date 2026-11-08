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
import { POSITIONS } from '@/lib/positions'
import { initialOf } from '@/lib/utils'

interface Profile {
  school?: string
  position?: string
  language?: string
  pulseReminder?: string
}

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'school', label: 'School and position' },
  { id: 'prefs', label: 'Preferences' },
  { id: 'devices', label: 'Signed-in devices' },
  { id: 'a11y', label: 'Accessibility' },
] as const
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
  const { records } = useQuery<Profile>('users')
  const { put, ready } = useMutations<Profile>('users')
  const me = records[0]

  const [section, setSection] = useState<Section>('profile')
  const [school, setSchool] = useState('')
  const [position, setPosition] = useState('')
  const [language, setLanguage] = useState('en')
  const [pulseReminder, setPulseReminder] = useState(true)
  const [saving, setSaving] = useState(false)

  const recordId = me?.recordId
  useEffect(() => {
    const d = me?.data
    if (!d) return
    setSchool(d.school ?? '')
    setPosition(d.position ?? '')
    setLanguage(d.language || 'en')
    setPulseReminder(d.pulseReminder !== 'off')
    // Load once per record; later edits stay local until saved.
  }, [recordId])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!recordId) return
    setSaving(true)
    try {
      await put(recordId, { school: school.trim(), position, language, pulseReminder: pulseReminder ? 'on' : 'off' })
      success('Saved', 'Your profile and preferences are up to date.')
    } catch {
      error('Could not save', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const d = me?.data
  const role = user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : 'Not set'
  const current = SECTIONS.find((s) => s.id === section)!
  // Drafts live on this page, so switching sections keeps unsaved edits; either form's Save sends all of them.
  const saveButton = (
    <Button type="submit" className="self-end" loading={saving} disabled={!ready || !recordId}>
      Save changes
    </Button>
  )

  return (
    <div className="flex w-full flex-col gap-6 lg:gap-8">
      <PageHeader title="Settings" description="Your profile, school and preferences." />

      <div className="stagger-rise grid grid-cols-1 items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-5">
        <nav aria-label="Settings sections" className="min-w-0">
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
                  {s.label}
                </Button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {/* Keyed by section: a switch re-mounts the panel so it rises in again. */}
          <Card key={section} id="settings-panel" title={current.label} className="animate-rise">
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
                    <p className="truncate text-h3 font-bold">{user?.name || 'Not set'}</p>
                    <p className="truncate text-body text-muted-foreground">
                      {[d?.position, d?.school].filter(Boolean).join(' at ') || 'Add your school and position'}
                    </p>
                  </div>
                </div>
                <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                  <Field label="Email" value={user?.email ?? 'Not set'} />
                  <Field label="Access level" value={role} />
                </dl>
                <Button variant="secondary" className="self-start" onClick={() => endSession()}>
                  Sign out
                </Button>
              </>
            )}

            {section === 'school' && (
              <form onSubmit={save} className="flex flex-col gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="school">School</Label>
                    <Input id="school" value={school} maxLength={120} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. Riverside Elementary" autoComplete="organization" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="position">Position</Label>
                    <Select value={position} onValueChange={setPosition}>
                      <SelectTrigger id="position">
                        <SelectValue placeholder="Choose your position" />
                      </SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
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
                  <Label htmlFor="language">Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger id="language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-body">
                  <input
                    type="checkbox"
                    checked={pulseReminder}
                    onChange={(e) => setPulseReminder(e.target.checked)}
                    className="mt-1 size-5 shrink-0 cursor-pointer accent-foreground"
                  />
                  <span>
                    Remind me to log a Pulse check-in after class
                    <span className="block text-small text-muted-foreground">You can always add one yourself from the dashboard.</span>
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
                  <h3 className="text-h3 font-bold">Text size</h3>
                  <p className="max-w-[60ch] text-body text-muted-foreground">
                    To read larger text, use your browser&apos;s zoom or text size: every page is built to work at 200%.
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
