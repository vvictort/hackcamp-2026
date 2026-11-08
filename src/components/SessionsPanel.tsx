/**
 * "Signed-in devices": every active session for the current user, with the
 * ability to sign one out, sign out all the others, or sign out everywhere.
 * Sessions are the auth server's (Better Auth) own records, so a person only
 * ever sees and revokes their own.
 */

import { useCallback, useEffect, useState } from 'react'
import { authClient, useSession } from 'deepspace'
import { Monitor, Smartphone } from 'lucide-react'
import { Button, Card, Spinner, useToast } from '@/components/ui'
import { endSession } from '@/lib/session'

interface SessionRow {
  token: string
  userAgent?: string | null
  updatedAt?: string | Date
  createdAt?: string | Date
}

/** "Chrome on Windows", from a user-agent string. Good enough for a device label. */
export function deviceLabel(ua?: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser'
  const os = /windows/i.test(ua) ? 'Windows' : /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'a device'
  return `${browser} on ${os}`
}

const when = (d?: string | Date) =>
  d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'

export function SessionsPanel() {
  const { data } = useSession()
  const { error } = useToast()
  const currentToken = data?.session?.token
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authClient.listSessions()
    if (res.error) {
      setRows([])
      return
    }
    setRows(((res.data ?? []) as SessionRow[]).sort((a, b) => +new Date(b.updatedAt ?? 0) - +new Date(a.updatedAt ?? 0)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(id: string, fn: () => Promise<{ error?: unknown } | undefined>) {
    setBusy(id)
    try {
      const res = await fn()
      if (res?.error) throw new Error('refused')
      await load()
    } catch {
      error('Could not sign out', 'Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const others = (rows ?? []).filter((r) => r.token !== currentToken)

  return (
    <Card title="Signed-in devices">
      <p className="text-body text-muted-foreground">
        These are the browsers and devices currently signed in to your account. Sign out any you do not recognise.
      </p>
      {rows === null ? (
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Spinner /> Loading
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((s) => {
            const mobile = /iphone|ipad|android/i.test(s.userAgent ?? '')
            const Icon = mobile ? Smartphone : Monitor
            const current = s.token === currentToken
            return (
              <li key={s.token} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-bold">
                    {deviceLabel(s.userAgent)}
                    {current && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-small font-semibold">This device</span>}
                  </p>
                  <p className="text-small text-muted-foreground">Last active {when(s.updatedAt ?? s.createdAt)}</p>
                </div>
                {!current && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busy === s.token}
                    onClick={() => run(s.token, () => authClient.revokeSession({ token: s.token }))}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {others.length > 0 && (
          <Button variant="secondary" loading={busy === 'others'} onClick={() => run('others', () => authClient.revokeOtherSessions())}>
            Sign out other devices
          </Button>
        )}
        <Button
          variant="secondary"
          loading={busy === 'all'}
          onClick={async () => {
            setBusy('all')
            try {
              await authClient.revokeSessions()
            } finally {
              await endSession()
            }
          }}
        >
          Sign out everywhere
        </Button>
      </div>
    </Card>
  )
}
