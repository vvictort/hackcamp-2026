import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, Play, Star, Volume2 } from 'lucide-react'
import { Button, Card, Input, Progress, StatusBadge } from '@/components/ui'
import type { SessionNextResponse } from '@/server/altamira/contract/api'
import { useAltamiraMe } from '@/lib/altamira/role'
import {
  PracticeApiError,
  sessionNext,
  sessionProgress,
  sessionRespond,
  startStudentMode,
  symbolsFor,
  symbolUrl,
  type StudentSession,
} from '@/lib/altamira/practice-api'
import { StudentSelect } from './StudentSelect'
import { useCt } from './useCt'
import { useStudents } from './useStudents'

type Item = NonNullable<SessionNextResponse['item']>
type Phase = 'idle' | 'starting' | 'asking' | 'feedback' | 'done' | 'ended'

const BIG = 'min-h-16 min-w-16 text-h3'

/** Reads text aloud with the browser voice. Returns false when the browser has none. */
export function speak(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  return true
}

export function StudentModePanel() {
  const ct = useCt()
  const { role, me } = useAltamiraMe()
  const { students } = useStudents()
  const ownStudent = role === 'student' ? (me?.parentOf[0] ?? me?.students[0]?.id ?? '') : ''
  const [picked, setPicked] = useState('')
  const studentId = ownStudent || picked
  const [phase, setPhase] = useState<Phase>('idle')
  const [session, setSession] = useState<StudentSession | null>(null)
  const [item, setItem] = useState<Item | null>(null)
  const [supports, setSupports] = useState<SessionNextResponse['supports'] | null>(null)
  const [answered, setAnswered] = useState(0)
  const [stars, setStars] = useState(0)
  const [correct, setCorrect] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownAt = useRef(0)
  const readAloudUsed = useRef(false)

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof PracticeApiError && err.status === 410) {
        setPhase('ended')
        return
      }
      setError(fallback)
    },
    [],
  )

  const loadNext = useCallback(
    async (s: StudentSession) => {
      setBusy(true)
      try {
        const next = await sessionNext(s)
        setSupports(next.supports)
        setItem(next.item)
        setText('')
        shownAt.current = Date.now()
        readAloudUsed.current = false
        setPhase(next.item ? 'asking' : 'done')
        if (!next.item) {
          const p = await sessionProgress(s).catch(() => null)
          if (p) setStars(p.goals.reduce((n, g) => n + g.completed, 0))
        }
      } catch (err) {
        fail(err, ct('capture.student.startFailed'))
      } finally {
        setBusy(false)
      }
    },
    [ct, fail],
  )

  async function start() {
    if (!studentId) return
    setError(null)
    setPhase('starting')
    try {
      const s = await startStudentMode(studentId)
      setSession(s)
      setAnswered(0)
      await loadNext(s)
    } catch {
      setPhase('idle')
      setError(ct('capture.student.startFailed'))
    }
  }

  async function submit(response: string) {
    if (!session || !item || !response.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await sessionRespond(session, {
        itemId: item.itemId,
        response: response.trim(),
        durationMs: Math.max(1, Date.now() - shownAt.current),
        readAloudUsed: readAloudUsed.current,
      })
      setCorrect(res.correct)
      setAnswered((n) => n + 1)
      if (res.correct) setStars((n) => n + 1)
      setPhase('feedback')
    } catch (err) {
      fail(err, ct('capture.student.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Stop any speech when the item changes or the page closes.
  useEffect(() => () => void window.speechSynthesis?.cancel(), [item])

  const large = supports?.largerText ? 'text-display' : 'text-h1'
  // The total is not known up front, so the bar fills toward the end and is full when practice is done.
  const pct = phase === 'done' ? 100 : Math.round((answered / (answered + 1)) * 100)

  return (
    <div className="flex flex-col gap-6">
      {(phase === 'idle' || phase === 'starting') && (
        <Card>
          {!ownStudent && <StudentSelect students={students} value={picked} onChange={setPicked} />}
          {role === 'student' && !ownStudent && <p>{ct('capture.student.noStudent')}</p>}
          {error && (
            <p role="alert" className="text-destructive-strong">
              {error}
            </p>
          )}
          <div>
            <Button size="lg" className={BIG} onClick={start} disabled={!studentId} loading={phase === 'starting'}>
              <Play aria-hidden />
              {phase === 'starting' ? ct('capture.student.starting') : ct('capture.student.start')}
            </Button>
          </div>
        </Card>
      )}

      {phase === 'ended' && (
        <Card>
          <p role="alert">{ct('capture.student.ended')}</p>
          <div>
            <Button size="lg" onClick={() => setPhase('idle')}>
              {ct('capture.student.start')}
            </Button>
          </div>
        </Card>
      )}

      {(phase === 'asking' || phase === 'feedback') && item && (
        <Card>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3 text-small font-semibold">
              <span>{ct('capture.student.question', { n: answered + (phase === 'asking' ? 1 : 0) })}</span>
              <span>{ct('capture.student.done', { n: answered })}</span>
            </div>
            <Progress value={pct} label={ct('capture.student.progress')} tone="signal" className="h-4" />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {symbolsFor(item.prompt).map((name) => (
              <img key={name} src={symbolUrl(name)} alt="" aria-hidden className="size-24 rounded-md border border-border bg-white p-1" />
            ))}
          </div>
          <p className={`${large} font-extrabold leading-snug`}>{item.prompt}</p>

          <div className="flex flex-wrap gap-3">
            <Button
              variant={supports?.readAloud ? 'default' : 'outline'}
              size="lg"
              className={BIG}
              onClick={() => {
                readAloudUsed.current = true
                if (!speak([item.prompt, ...(item.options ?? [])].join('. '))) setError(ct('capture.student.readAloudUnsupported'))
              }}
            >
              <Volume2 aria-hidden />
              {ct('capture.student.readAloud')}
            </Button>
          </div>

          {phase === 'asking' ? (
            item.options?.length ? (
              <div role="group" aria-label={ct('capture.student.answer')} className="flex flex-wrap gap-4">
                {item.options.map((o) => (
                  <Button key={o} variant="outline" size="lg" className={`${BIG} px-8`} disabled={busy} onClick={() => submit(o)}>
                    {o}
                  </Button>
                ))}
              </div>
            ) : (
              <form
                className="flex flex-wrap items-end gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit(text)
                }}
              >
                <label className="flex flex-col gap-2">
                  <span className="font-semibold">{ct('capture.student.answer')}</span>
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    inputMode={item.format === 'numeric' ? 'decimal' : 'text'}
                    autoComplete="off"
                    className="h-16 w-64 text-h2"
                  />
                </label>
                <Button type="submit" size="lg" className={BIG} loading={busy} disabled={!text.trim()}>
                  {busy ? ct('capture.student.saving') : ct('capture.student.submit')}
                </Button>
              </form>
            )
          ) : (
            <div role="status" className="flex flex-col gap-4">
              <StatusBadge tone={correct ? 'success' : 'info'}>{correct ? ct('capture.student.good') : ct('capture.student.tryAgain')}</StatusBadge>
              <div>
                <Button size="lg" className={BIG} onClick={() => session && void loadNext(session)} loading={busy}>
                  {ct('capture.student.next')}
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive-strong">
              {error}
            </p>
          )}
        </Card>
      )}

      {phase === 'done' && (
        <Card>
          <Progress value={100} label={ct('capture.student.progress')} tone="signal" className="h-4" />
          <p role="status" className="flex items-center gap-3 text-h1 font-extrabold">
            <CircleCheck aria-hidden className="size-10" />
            {item === null && answered === 0 ? ct('capture.student.noItems') : ct('capture.student.finished')}
          </p>
          <p className="flex items-center gap-2 text-h3 font-semibold">
            <Star aria-hidden className="size-6" />
            {ct('capture.student.stars', { n: stars })}
          </p>
          <div>
            <Button size="lg" variant="secondary" onClick={() => session && void loadNext(session)} loading={busy}>
              {ct('capture.student.again')}
            </Button>
          </div>
        </Card>
      )}

      <p className="text-small text-muted-foreground">
        {ct('capture.student.symbols')}{' '}
        <a className="underline" href="/symbols/mulberry/ATTRIBUTION.md" target="_blank" rel="noreferrer">
          {ct('capture.student.symbolsLink')}
        </a>
      </p>
    </div>
  )
}
