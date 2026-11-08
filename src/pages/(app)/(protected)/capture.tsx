import { useState } from 'react'
import { RoleGate } from '@/lib/altamyra/RoleGate'
import { useAltamyraMe, visibleStudents } from '@/lib/altamyra/role'
import { Card, PageHeader } from '@/components/ui'
import { lastStudent, rememberStudent } from '@/lib/altamyra/capture-api'
import { cn } from '@/lib/utils'
import { EaPanel } from '@/components/capture/EaPanel'
import { NoteCapture } from '@/components/capture/NoteCapture'
import { PhotoCapture } from '@/components/capture/PhotoCapture'
import { ReviewList } from '@/components/capture/ReviewList'
import { StudentSelect } from '@/components/capture/StudentSelect'
import { VideoCapture } from '@/components/capture/VideoCapture'
import { useLang } from '@/i18n'
import type { MessageKey } from '@/i18n/en'

const KINDS = [
  { id: 'photo', label: 'capture.page.kindPhoto' },
  { id: 'video', label: 'capture.page.kindVideo' },
  { id: 'note', label: 'capture.page.kindNote' },
  { id: 'event', label: 'capture.page.kindEvent' },
] as const satisfies readonly { id: string; label: MessageKey }[]
type Kind = (typeof KINDS)[number]['id']

function CapturePageBody() {
  const { t } = useLang()
  const students = visibleStudents(useAltamyraMe().me)
  const [picked, setPicked] = useState(lastStudent)
  const [kind, setKind] = useState<Kind>('photo')
  const [refresh, setRefresh] = useState(0)
  // A remembered student who is no longer on the list is ignored.
  // Defaults to the first assigned student, so the EA starts with the child they are with.
  const studentId = students.some((s) => s.id === picked) ? picked : (students[0]?.id ?? '')
  const bump = () => setRefresh((n) => n + 1)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('capture.page.title')} description={t('capture.page.description')} />
      <Card>
        {students.length === 0 && <p>{t('capture.common.noStudents')}</p>}
        <StudentSelect
          students={students}
          value={studentId}
          onChange={(id) => {
            setPicked(id)
            rememberStudent(id)
          }}
        />
      </Card>

      {studentId ? (
        <>
          <div role="radiogroup" aria-label={t('capture.page.kind')} className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                onClick={() => setKind(k.id)}
                className={cn(
                  'min-h-12 cursor-pointer rounded-full border px-5 text-label font-semibold',
                  kind === k.id ? 'border-transparent bg-primary text-primary-foreground' : 'border-input bg-card text-foreground hover:border-foreground',
                )}
              >
                {t(k.label)}
              </button>
            ))}
          </div>
          {kind === 'photo' && <PhotoCapture studentId={studentId} onScored={bump} />}
          {kind === 'video' && <VideoCapture key={studentId} studentId={studentId} />}
          {kind === 'note' && <NoteCapture key={studentId} studentId={studentId} />}
          {kind === 'event' && <EaPanel key={studentId} studentId={studentId} />}
        </>
      ) : (
        students.length > 0 && <p className="text-muted-foreground">{t('capture.page.pickStudent')}</p>
      )}

      <section id="to-confirm" aria-labelledby="to-confirm-h" className="flex flex-col gap-4">
        <div>
          <h2 id="to-confirm-h" className="text-h2 font-extrabold">
            {t('capture.page.toConfirm')}
          </h2>
          <p className="text-muted-foreground">{t('capture.page.toConfirmHint')}</p>
        </div>
        <ReviewList key={refresh} />
      </section>
    </div>
  )
}

export default function CapturePage() {
  return (
    <RoleGate path="/capture">
      <CapturePageBody />
    </RoleGate>
  )
}
