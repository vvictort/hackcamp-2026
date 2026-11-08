/** Lesson Lens (PRD 1A): upload a lesson, see per-student gaps, review adaptations, print sheets. */
import { useMemo, useState } from 'react'
import { useQuery, useUser } from 'deepspace'
import { History } from 'lucide-react'
import { Badge, PageHeader } from '@/components/ui'
import { LensUpload } from '@/components/lens/LensUpload'
import { LensStudentCard } from '@/components/lens/LensResults'
import { LensSheet } from '@/components/lens/LensSheet'
import { lensText, useLensAnalysis } from '@/lib/lessonLens'

interface StudentRow { ownerId?: string; key: string; name: string; goals: string }

export default function LessonLensPage() {
  const { user } = useUser()
  const ownerId = user?.id ?? ''
  const rows = useQuery<StudentRow>('students', { where: { ownerId } })
  const lens = useLensAnalysis()
  const [sheetId, setSheetId] = useState<string | null>(null)

  const options = useMemo(
    () => rows.records.filter((r) => r.data.ownerId === ownerId && r.data.goals && r.data.goals !== '[]').map((r) => ({ key: r.data.key, name: r.data.name })),
    [rows.records, ownerId],
  )
  const { analysis } = lens
  const sheet = analysis?.students.find((s) => s.studentId === sheetId)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader title={lensText('lens.title')} description={lensText('lens.description')} />
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
      {sheet && analysis && <LensSheet student={sheet} subject={analysis.subject} onClose={() => setSheetId(null)} />}
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
