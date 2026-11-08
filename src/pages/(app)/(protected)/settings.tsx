/**
 * Settings (gated): (protected)/_layout.tsx already wraps this in <AuthGate>.
 * Profile (school, position) and preferences live on the user's own `users`
 * record (see src/schemas/users-schema.ts); a person can only read and edit
 * their own row.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { signOut, useMutations, useQuery, useUser } from 'deepspace'
import { MonitorSmartphone } from 'lucide-react'
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'

interface Profile {
  school?: string
  position?: string
  language?: string
  pulseReminder?: string
}

const POSITIONS = [
  'Classroom teacher',
  'Resource / case-manager teacher',
  'Education assistant',
  'Substitute teacher',
  'Administrator',
  'District inclusive-education lead',
]

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
  const initial = (user?.name ?? user?.email ?? '?').trim()[0]?.toUpperCase()
  const role = user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : 'Not set'
  const card = 'flex flex-col gap-3 rounded-lg bg-card p-4 shadow-raised sm:p-5'

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-6 sm:px-6 lg:gap-5 lg:px-0 lg:py-0">
      <header className="flex flex-col gap-1 lg:pt-1">
        <h1 className="text-display font-extrabold">Settings</h1>
        <p className="text-body text-muted-foreground">Your profile, school and preferences.</p>
      </header>

      <div className="grid gap-3 lg:gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-3 lg:gap-4 xl:col-span-5">
          <section aria-labelledby="account-title" className={card}>
            <h2 id="account-title" className="sr-only">Your account</h2>
            <div className="flex items-center gap-4">
              <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-h2 font-bold text-primary-foreground">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate text-h2 font-extrabold">{user?.name ?? 'Not set'}</p>
                <p className="truncate text-body text-muted-foreground">
                  {[d?.position, d?.school].filter(Boolean).join(' at ') || 'Add your school and position'}
                </p>
              </div>
            </div>
            <dl className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Field label="Email" value={user?.email ?? 'Not set'} />
              <Field label="Access level" value={role} />
            </dl>
            <Button variant="secondary" className="self-start" onClick={() => signOut()}>
              Sign out
            </Button>
          </section>

          <section className={`${card} flex-1 sm:flex-row sm:items-start`}>
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <MonitorSmartphone className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-h2 font-bold">Text size</h2>
              <p className="text-body text-muted-foreground">
                To read larger text, use your browser&apos;s zoom or text size: every page is built to work at 200%.
              </p>
            </div>
          </section>
        </div>

        <form onSubmit={save} className="flex flex-col gap-3 lg:gap-4 xl:col-span-7">
          <section aria-labelledby="profile-title" className={card}>
            <h2 id="profile-title" className="text-h2 font-bold">School and position</h2>
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
          </section>

          <section aria-labelledby="prefs-title" className={`${card} flex-1`}>
            <h2 id="prefs-title" className="text-h2 font-bold">Preferences</h2>
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
            <Button type="submit" className="mt-auto self-end" loading={saving} disabled={!ready || !recordId}>
              Save changes
            </Button>
          </section>
        </form>
      </div>
    </div>
  )
}
