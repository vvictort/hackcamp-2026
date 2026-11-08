import { useState } from 'react'
import { Download, Printer, X } from 'lucide-react'
import { Badge, Button, Card } from '@/components/ui'
import { lensText, type StudentAnalysis } from '@/lib/lessonLens'

const PRINT_CSS = `@media print{body *{visibility:hidden}#lens-sheet,#lens-sheet *{visibility:visible}#lens-sheet{position:absolute;inset:0;padding:24px;background:#fff;color:#000;box-shadow:none}.lens-noprint{display:none!important}}`

/** One student's printable sheet: adaptations, then goal-coded checks (G1-C2 ...). */
export function LensSheet({ student, subject, onClose }: { student: StudentAnalysis; subject: string; onClose: () => void }) {
  const [making, setMaking] = useState(false)
  const pdf = async () => {
    setMaking(true)
    try {
      const { downloadSheetPdf } = await import('./lensPdf')
      await downloadSheetPdf(student, subject)
    } finally {
      setMaking(false)
    }
  }
  return (
    <Card title={lensText('lens.sheetTitle', { name: student.name })} id="lens-sheet">
      <style>{PRINT_CSS}</style>
      <p className="-mt-2 text-body text-muted-foreground">{lensText('lens.sheetLesson', { subject })}</p>
      <h3 className="text-label font-bold">{lensText('lens.sheetAdaptations')}</h3>
      <ul className="flex flex-col gap-2">
        {student.suggestions
          .filter((s) => s.state !== 'rejected')
          .map((s, i) => (
            <li key={s.id || i} className="flex items-start gap-3 text-body">
              <Badge variant="outline">{lensText(s.label === 'modify' ? 'lens.modify' : 'lens.adapt')}</Badge>
              <span>{s.text}</span>
            </li>
          ))}
      </ul>
      <h3 className="text-label font-bold">{lensText('lens.sheetChecks')}</h3>
      {student.checks.length ? (
        <ul className="flex flex-col gap-2">
          {student.checks.map((c) => (
            <li key={c.code} className="flex items-start gap-3 text-body">
              <span aria-hidden className="mt-1 size-4 shrink-0 rounded-sm border-2 border-foreground" />
              <span className="sr-only">{lensText('lens.sheetDone')}</span>
              <span className="w-14 shrink-0 font-bold tabular-nums">{c.code}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">{lensText('lens.noChecks')}</p>
      )}
      <div className="lens-noprint flex flex-wrap gap-3">
        <Button onClick={() => window.print()}>
          <Printer aria-hidden />
          {lensText('lens.print')}
        </Button>
        <Button variant="outline" loading={making} onClick={pdf}>
          <Download aria-hidden />
          {making ? lensText('lens.pdfMaking') : lensText('lens.downloadPdf')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          <X aria-hidden />
          {lensText('lens.close')}
        </Button>
      </div>
    </Card>
  )
}
