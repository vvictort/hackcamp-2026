/**
 * Settings (gated): (protected)/_layout.tsx already wraps this in <AuthGate>.
 */

import { signOut, useUser } from 'deepspace'
import { MonitorSmartphone } from 'lucide-react'
import { Button } from '@/components/ui'

export default function SettingsPage() {
  const { user } = useUser()

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-0 lg:py-0">
      <h1 className="text-display font-extrabold">Settings</h1>

      <section className="flex flex-col gap-5 rounded-lg bg-card p-6 shadow-raised">
        <h2 className="text-h2 font-bold">Your account</h2>
        <dl className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <dt className="text-label font-semibold text-muted-foreground">Name</dt>
            <dd className="text-body">{user?.name ?? 'Not set'}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label font-semibold text-muted-foreground">Email</dt>
            <dd className="text-body break-words">{user?.email ?? 'Not set'}</dd>
          </div>
        </dl>
        <Button variant="secondary" className="self-start" onClick={() => signOut()}>
          Sign out
        </Button>
      </section>

      <section className="flex gap-5 rounded-lg bg-card p-6 shadow-raised">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <MonitorSmartphone className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="text-h2 font-bold">Appearance</h2>
          <p className="text-body text-muted-foreground">
            To read larger text, use your browser&apos;s zoom or text size: every page is built to work at
            200%.
          </p>
        </div>
      </section>
    </div>
  )
}
