import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormField, Input, Progress, Textarea, useToast } from '@/components/ui'
import { extractIepText, importIepTimed } from '@/lib/altamira/profile-api'
import { confirmIep, fileToBase64 } from '@/lib/altamira/students-api'
import type { IepImportResponse } from '@/server/altamira/contract/api'
import type { IepSections } from '@/server/altamira/contract/student'
import { SAMPLE_IEP_TEXT } from './sampleIep'
import { lines, s } from './text'

interface Props {
  studentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
}

/** Import a CB-IEP (pasted text or PDF), review parsed goals beside the source, edit, confirm the version. */
export function IepImportDialog({ studentId, open, onOpenChange, onConfirmed }: Props) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IepImportResponse | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [draft, setDraft] = useState<IepSections | null>(null)
  const [modSubjects, setModSubjects] = useState('')
  const [phase, setPhase] = useState<'pdf' | 'ai'>('ai')
  const [elapsed, setElapsed] = useState(0)
  const parsedRef = useRef<HTMLHeadingElement>(null)

  // Progress: count seconds while a request runs.
  useEffect(() => {
    if (!busy || result) return
    setElapsed(0)
    const id = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [busy, result])
  // Move focus to the review so keyboard users land beside the parsed fields.
  useEffect(() => {
    if (result) parsedRef.current?.focus()
  }, [result])

  const reset = () => {
    setText('')
    setFileName(null)
    setError(null)
    setResult(null)
    setDraft(null)
  }
  const close = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const file = fileRef.current?.files?.[0]
      let source = text
      if (file) {
        setPhase('pdf')
        source = (
          await extractIepText(studentId, { sourceKind: 'pdf', fileName: file.name, contentType: file.type || 'application/pdf', bytesBase64: await fileToBase64(file) })
        ).text
      }
      setPhase('ai')
      const res = await importIepTimed(studentId, { sourceKind: 'text', text: source })
      setSourceText(source)
      setResult(res)
      setDraft(res.iep.sections)
      setModSubjects(res.iep.modificationSubjects.join(', '))
    } catch (e) {
      setError(s('students.import.failed', { message: e instanceof Error ? e.message : s('students.error.action') }))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!result || !draft) return
    setBusy(true)
    setError(null)
    try {
      await confirmIep(studentId, result.iep.version, {
        expectedVersion: result.iep.rowVersion,
        sections: draft,
        modificationSubjects: modSubjects.split(',').map((x) => x.trim()).filter(Boolean),
      })
      toast.success(s('students.import.confirmedToast'))
      reset()
      onOpenChange(false)
      onConfirmed()
    } catch (e) {
      setError(e instanceof Error ? e.message : s('students.error.action'))
    } finally {
      setBusy(false)
    }
  }

  const set = (patch: Partial<IepSections>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const setGoal = (i: number, patch: Partial<IepSections['goals'][number]>) =>
    setDraft((d) => (d ? { ...d, goals: d.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) } : d))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{s('students.import.title')}</DialogTitle>
          <DialogDescription>{s(result ? 'students.import.reviewHelp' : 'students.import.help')}</DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="flex flex-col gap-4">
            <FormField label={s('students.import.paste')}>
              <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
            </FormField>
            <FormField label={s('students.import.pdf')} hint={s('students.import.pdfHint')}>
              <Input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
            </FormField>
            <div>
              <Button variant="secondary" onClick={() => { setText(SAMPLE_IEP_TEXT); if (fileRef.current) fileRef.current.value = ''; setFileName(null) }}>
                {s('students.import.sample')}
              </Button>
            </div>
          </div>
        )}

        {result && draft && (
          <div className="grid gap-4 md:grid-cols-2">
            <section aria-labelledby="iep-src" className="flex min-w-0 flex-col gap-2">
              <h3 id="iep-src" className="text-label font-semibold">{s('students.import.source')}</h3>
              <pre tabIndex={0} className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary p-3 text-small">
                {sourceText || s('students.import.pdfSource', { name: fileName ?? 'PDF' })}
              </pre>
            </section>
            <section aria-labelledby="iep-parsed" className="flex min-w-0 flex-col gap-3">
              <h3 id="iep-parsed" ref={parsedRef} tabIndex={-1} className="text-label font-semibold">{s('students.import.parsed')}</h3>
              <div className="max-h-[50vh] overflow-auto pe-1 flex flex-col gap-3">
                <FormField label={s('students.import.grade')}>
                  <Input value={draft.student.grade} onChange={(e) => set({ student: { ...draft.student, grade: e.target.value } })} />
                </FormField>
                {draft.goals.map((g, i) => (
                  <fieldset key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-label font-semibold">{s('students.import.goalN', { n: i + 1 })}</legend>
                    <FormField label={s('students.import.area')}>
                      <Input value={g.area} onChange={(e) => setGoal(i, { area: e.target.value })} />
                    </FormField>
                    <FormField label={s('students.import.goalText')}>
                      <Textarea rows={2} value={g.text} onChange={(e) => setGoal(i, { text: e.target.value })} />
                    </FormField>
                  </fieldset>
                ))}
                {(['accommodations', 'supports'] as const).map((k) => (
                  <FormField key={k} label={s(`students.import.${k}` as const)} hint={s('students.import.onePerLine')}>
                    <Textarea rows={3} value={draft[k].join('\n')} onChange={(e) => set({ [k]: lines(e.target.value) })} />
                  </FormField>
                ))}
                <FormField label={s('students.import.strengths')} hint={s('students.import.onePerLine')}>
                  <Textarea rows={2} value={draft.profile.strengths.join('\n')} onChange={(e) => set({ profile: { ...draft.profile, strengths: lines(e.target.value) } })} />
                </FormField>
                <FormField label={s('students.import.modSubjects')} hint={s('students.import.modHint')}>
                  <Input value={modSubjects} onChange={(e) => setModSubjects(e.target.value)} />
                </FormField>
                <p className="text-small text-muted-foreground">{s('students.import.objectivesProposed', { n: result.objectiveProposals.length })}</p>
              </div>
            </section>
          </div>
        )}

        {busy && !result && <div role="status" className="flex flex-col gap-1">
            <p className="text-small text-muted-foreground">{s(phase === 'pdf' ? 'students.import.workingPdf' : 'students.import.working')}</p>
            <Progress value={Math.min(95, Math.round((elapsed / 40) * 100))} />
            <p className="text-small text-muted-foreground">{s('students.import.progress', { n: elapsed })}</p>
          </div>}
        {error && <p role="alert" className="text-small font-semibold text-destructive-strong">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{s('students.cancel')}</Button>
          {!result ? (
            <Button loading={busy} disabled={!text.trim() && !fileName} onClick={submit}>{s('students.import.parse')}</Button>
          ) : (
            <Button loading={busy} onClick={confirm}>{s('students.import.confirm')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
