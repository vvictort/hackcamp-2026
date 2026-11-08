/** Lesson Lens (PRD 1A): upload a lesson, see per-student gaps, review adaptations, print sheets. */
import { RoleGate } from '@/lib/altamira/RoleGate'
import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { Badge, PageHeader } from '@/components/ui'
import { LensUpload } from '@/components/lens/LensUpload'
import { LensStudentCard } from '@/components/lens/LensResults'
import { LensSheet } from '@/components/lens/LensSheet'
import { lensText, useLensAnalysis, useLensRoster } from '@/lib/lessonLens'

function LessonLensPageBody() {
  const roster = useLensRoster()
  const lens = useLensAnalysis(roster.students)
  const [sheetId, setSheetId] = useState<string | null>(null)

  const options = useMemo(() => roster.students.map((s) => ({ key: s.id, name: s.name })), [roster.students])
  const { analysis } = lens
  const sheet = analysis?.students.find((s) => s.studentId === sheetId)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader title={lensText('lens.title')} description={lensText('lens.description')} />
      {roster.loading && <p role="status" className="text-body text-muted-foreground">{lensText('lens.rosterLoading')}</p>}
      {roster.failed && <p role="alert" className="text-body text-destructive">{lensText('lens.rosterFailed')}</p>}
      <LensUpload students={options} running={lens.running} onSubmit={(i) => { setSheetId(null); void lens.analyze(i) }} />
      {analysis && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          {analysis.cached ? (
            <Badge variant="info" title={lensText('lens.cachedHint')}>
              <History aria-hidden />
              {lensText('lens.cached')}
            </Badge>
          ) : (
            <Badge variant="success">{lensText('lens.fresh')}</Badge>
          )}
          <Badge variant="outline">{lensText(analysis.source === 'gemini' ? 'lens.sourceGemini' : 'lens.sourceRules')}</Badge>
        </div>
      )}
      {sheet && analysis && <LensSheet student={sheet} subject={analysis.subject} codes={lens.codes[sheet.studentId] ?? {}} onClose={() => setSheetId(null)} />}
      {analysis?.students.map((st) => (
        <LensStudentCard
          key={st.studentId}
          st={st}
          a={{ busy: lens.busy, decide: (id, d) => void lens.decide(id, d), edit: lens.edit, regenerate: (id) => void lens.regenerate(id), approveAll: (s) => void lens.approveAll(s), dropCheck: lens.dropCheck, openSheet: setSheetId }}
        />
      ))}
    </div>
  )
}

export default function LessonLensPage() {
  return (
    <RoleGate path="/lesson-lens">
      <LessonLensPageBody />
    </RoleGate>
  )
}
