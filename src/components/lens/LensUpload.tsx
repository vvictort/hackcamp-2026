import { useState } from 'react'
import { FileUp, Sparkles, X } from 'lucide-react'
import { Button, Card, Input, Textarea } from '@/components/ui'
import { lensText, type AnalyzeInput, type LensImage } from '@/lib/lessonLens'
import { extractPdfText } from '@/server/altamira/routes/pdf-text'

export interface LensStudentOption {
  key: string
  name: string
}

const MAX_SIDE = 1600

/** Shrinks a photo to a JPEG of at most 1600 px so it stays small; the server reads its text. */
export async function shrinkImage(file: File): Promise<LensImage> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
}

/** Text of an uploaded lesson, read in the browser. A photo comes back as an image for the server to read. */
export async function readLessonFile(file: File): Promise<{ text: string; image: LensImage | null }> {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('image/')) return { text: '', image: await shrinkImage(file) }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return { text: (await extractPdfText(new Uint8Array(await file.arrayBuffer()))).trim(), image: null }
  }
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { text: r.value.trim(), image: null }
  }
  throw new Error('unsupported')
}

export function LensUpload({ students, running, onSubmit }: { students: LensStudentOption[]; running: boolean; onSubmit: (i: AnalyzeInput) => void }) {
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [fileName, setFileName] = useState('')
  const [note, setNote] = useState('')
  const [reading, setReading] = useState(false)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [image, setImage] = useState<LensImage | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setNote('')
    setReading(true)
    try {
      const r = await readLessonFile(file)
      setFileName(file.name)
      setImage(r.image)
      if (r.image) setNote(lensText('lens.imageNote'))
      else if (!r.text) setNote(lensText('lens.fileNoText'))
      else setText(r.text)
    } catch {
      setNote(lensText('lens.fileBad'))
    } finally {
      setReading(false)
    }
  }
  const ids = students.filter((s) => !off.has(s.key)).map((s) => s.key)
  const ready = (text.trim().length > 0 || !!image) && ids.length > 0 && !running && !reading

  return (
    <Card title={lensText('lens.lessonLabel')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onSubmit({ lessonText: text, ...(image && !text.trim() ? { image } : {}), subject: subject.trim() || undefined, studentIds: ids })
        }}
      >
        <Textarea aria-label={lensText('lens.lessonLabel')} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={lensText('lens.lessonPlaceholder')} />
        <div className="flex flex-col gap-2">
          <label htmlFor="lens-file" className="flex w-fit cursor-pointer items-center gap-2 rounded-full bg-secondary px-4 py-3 text-label font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
            <FileUp aria-hidden className="size-5" />
            {lensText('lens.fileLabel')}
            <input id="lens-file" type="file" className="sr-only" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
          </label>
          {reading && <p role="status" className="text-small text-muted-foreground">{lensText('lens.fileReading')}</p>}
          {fileName && (
            <p className="flex items-center gap-2 text-small">
              {lensText('lens.fileLoaded', { name: fileName })}
              <Button type="button" size="icon" variant="ghost" aria-label={lensText('lens.fileClear')} onClick={() => (setFileName(''), setNote(''), setImage(null))}>
                <X aria-hidden />
              </Button>
            </p>
          )}
          {note && <p role="status" className="text-small text-muted-foreground">{note}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lens-subject" className="text-label font-semibold">{lensText('lens.subjectLabel')}</label>
          <Input id="lens-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <p className="text-small text-muted-foreground">{lensText('lens.subjectHint')}</p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-label font-semibold">{lensText('lens.studentsLabel')}</legend>
          {students.length ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {students.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    checked={!off.has(s.key)}
                    onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(s.key); else n.add(s.key); return n })}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-body text-muted-foreground">{lensText('lens.noStudents')}</p>
          )}
        </fieldset>
        <div>
          <Button type="submit" disabled={!ready} loading={running}>
            <Sparkles aria-hidden />
            {running ? lensText('lens.analyzing') : lensText('lens.analyze')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
