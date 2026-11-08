/**
 * "Signed-in devices": every active session for the current user, with the
 * ability to sign one out, sign out all the others, or sign out everywhere.
 * Renders content only; the Settings panel supplies the card and title.
 * Sessions are the auth server's (Better Auth) own records, so a person only
 * ever sees and revokes their own.
 */

import { useCallback, useEffect, useState } from 'react'
import { authClient, useSession } from 'deepspace'
import { Monitor, Smartphone } from 'lucide-react'
import { Button, Spinner, useToast } from '@/components/ui'
import { endSession } from '@/lib/session'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'

type Tr = (key: MessageKey, vars?: Record<string, string | number>) => string

interface SessionRow {
  token: string
  userAgent?: string | null
  updatedAt?: string | Date
  createdAt?: string | Date
}

/** "Chrome on Windows", from a user-agent string. Good enough for a device label. */
export function deviceLabel(ua: string | null | undefined, t: Tr): string {
  if (!ua) return t('app.devices.unknown')
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : t('app.devices.browser')
  const os = /windows/i.test(ua) ? 'Windows' : /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : t('app.devices.aDevice')
  return t('app.devices.label', { browser, os })
}

const when = (lang: string, unknown: string, d?: string | Date) =>
  d ? new Date(d).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : unknown

export function SessionsPanel() {
  const { data } = useSession()
  const { error } = useToast()
  const { t, lang } = useLang()
  const currentToken = data?.session?.token
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authClient.listSessions()
      if (res.error) throw new Error('refused')
      setUnavailable(false)
      setRows(((res.data ?? []) as SessionRow[]).sort((a, b) => +new Date(b.updatedAt ?? 0) - +new Date(a.updatedAt ?? 0)))
    } catch {
      // No toast: a failing list would repeat on every retry. Show it inline instead.
      setUnavailable(true)
      setRows([])
    }
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
      error(t('app.devices.signOutFailed'), t('app.devices.signOutFailedBody'))
    } finally {
      setBusy(null)
    }
  }

  const others = (rows ?? []).filter((r) => r.token !== currentToken)

  return (
    <>
      <p className="text-body text-muted-foreground">
        {t('app.devices.intro')}
      </p>
      {unavailable ? (
        <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-body text-muted-foreground">
          {t('app.devices.unavailable')}
        </p>
      ) : rows === null ? (
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Spinner /> {t('app.devices.loading')}
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
                    {deviceLabel(s.userAgent, t)}
                    {current && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-small font-semibold">{t('app.devices.thisDevice')}</span>}
                  </p>
                  <p className="text-small text-muted-foreground">{t('app.devices.lastActive', { when: when(lang, t('app.devices.unknownTime'), s.updatedAt ?? s.createdAt) })}</p>
                </div>
                {!current && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={busy === s.token}
                    onClick={() => run(s.token, () => authClient.revokeSession({ token: s.token }))}
                  >
                    {t('common.signOut')}
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
            {t('app.devices.signOutOthers')}
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
          {t('app.devices.signOutAll')}
        </Button>
      </div>
    </>
  )
}
