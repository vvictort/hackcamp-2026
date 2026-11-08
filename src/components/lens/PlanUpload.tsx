import { useState } from 'react'
import { FileUp, Sparkles, X } from 'lucide-react'
import { Button, Card, Textarea } from '@/components/ui'
import { s } from '@/components/students/text'
import { titleFromText } from '@/lib/altamyra/plans-api'
import { useLang } from '@/i18n'
import { extractPdfText } from '@/server/altamyra/routes/pdf-text'

/** Text of an uploaded lesson, read in the browser (PDF or Word). */
export async function readLessonFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return (await extractPdfText(new Uint8Array(await file.arrayBuffer()))).trim()
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim()
  }
  throw new Error('unsupported')
}

/** Paste or upload the original lesson plan. One button: save it and get the suggested changes. */
export function PlanUpload({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (v: { title: string; text: string }) => void }) {
  const { t } = useLang()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [note, setNote] = useState('')
  const [reading, setReading] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setNote('')
    setReading(true)
    try {
      const read = await readLessonFile(file)
      if (!read) setNote(t('lens.fileNoText'))
      else {
        setText(read)
        setFileName(file.name)
      }
    } catch {
      setNote(t('lens.fileBad'))
    } finally {
      setReading(false)
    }
  }
  const ready = text.trim().length > 0 && !busy && !reading

  return (
    <Card title={s('plan.add.title')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onSubmit({ title: titleFromText(text, s('plan.add.fallbackTitle')), text })
        }}
      >
        <Textarea aria-label={s('plan.add.paste')} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('lens.lessonPlaceholder')} />
        <div className="flex flex-col gap-2">
          <label htmlFor="plan-file" className="flex w-fit cursor-pointer items-center gap-2 rounded-full bg-secondary px-4 py-3 text-label font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
            <FileUp aria-hidden className="size-5" />
            {s('plan.add.file')}
            <input id="plan-file" type="file" className="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => (void onFile(e.target.files?.[0]), (e.target.value = ''))} />
          </label>
          {reading && <p role="status" className="text-small text-muted-foreground">{t('lens.fileReading')}</p>}
          {fileName && (
            <p className="flex items-center gap-2 text-small">
              {t('lens.fileLoaded', { name: fileName })}
              <Button type="button" size="icon" variant="ghost" aria-label={t('lens.fileClear')} onClick={() => (setFileName(''), setNote(''), setText(''))}>
                <X aria-hidden />
              </Button>
            </p>
          )}
          {note && <p role="status" className="text-small text-muted-foreground">{note}</p>}
        </div>
        {error && <p role="alert" className="text-small text-destructive">{error}</p>}
        <div>
          <Button type="submit" disabled={!ready} loading={busy}>
            <Sparkles aria-hidden />
            {busy ? s('plan.add.working') : s('plan.add.submit')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
