import { useEffect, useRef, useState } from 'react'
import { Pause, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { useLang } from '@/i18n'
import { playAloud, type Playback } from '@/lib/altamyra/tts'

/** Plays text aloud: Gemini audio from the server, else the browser voice. Icon + text, keyboard usable. */
export function ReadAloudButton({ text, lang = 'en', studentId, className }: { text: string; lang?: string; studentId?: string; className?: string }) {
  const { t } = useLang()
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const [unavailable, setUnavailable] = useState(false)
  const current = useRef<Playback | null>(null)

  const stop = () => {
    current.current?.stop()
    current.current = null
    setState('idle')
  }
  useEffect(() => () => current.current?.stop(), [])
  useEffect(stop, [text, lang])

  const click = async () => {
    if (state !== 'idle') return stop()
    setState('loading')
    setUnavailable(false)
    const p = await playAloud(text, lang, studentId)
    if (!p) {
      setState('idle')
      setUnavailable(true)
      return
    }
    current.current = p
    setState('playing')
    void p.ended.then(() => {
      if (current.current === p) {
        current.current = null
        setState('idle')
      }
    })
  }

  return (
    <span className={className}>
      <Button type="button" variant="outline" onClick={click} disabled={!text.trim()} aria-pressed={state === 'playing'}>
        {state === 'playing' ? <Pause aria-hidden /> : <Volume2 aria-hidden />}
        {state === 'loading' ? t('readAloud.loading') : state === 'playing' ? t('readAloud.stop') : t('readAloud.play')}
      </Button>
      {unavailable && (
        <span role="status" className="ml-3 text-small text-muted-foreground">
          {t('readAloud.unavailable')}
        </span>
      )}
    </span>
  )
}
