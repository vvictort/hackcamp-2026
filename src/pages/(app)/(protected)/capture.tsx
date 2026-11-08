import { useState } from 'react'
import { RoleGate } from '@/lib/altamira/RoleGate'
import { Card, PageHeader } from '@/components/ui'
import { lastStudent, rememberStudent } from '@/lib/altamira/capture-api'
import { cn } from '@/lib/utils'
import { EaPanel } from '@/components/capture/EaPanel'
import { NoteCapture } from '@/components/capture/NoteCapture'
import { PhotoCapture } from '@/components/capture/PhotoCapture'
import { ReviewList } from '@/components/capture/ReviewList'
import { StudentSelect } from '@/components/capture/StudentSelect'
import { VideoCapture } from '@/components/capture/VideoCapture'
import { useCt, type CaptureKey } from '@/components/capture/useCt'
import { useStudents } from '@/components/capture/useStudents'

const KINDS = [
  { id: 'photo', label: 'capture.page.kindPhoto' },
  { id: 'video', label: 'capture.page.kindVideo' },
  { id: 'note', label: 'capture.page.kindNote' },
  { id: 'event', label: 'capture.page.kindEvent' },
] as const satisfies readonly { id: string; label: CaptureKey }[]
type Kind = (typeof KINDS)[number]['id']

function CapturePageBody() {
  const ct = useCt()
  const { students, state, reload } = useStudents()
  const [picked, setPicked] = useState(lastStudent)
  const [kind, setKind] = useState<Kind>('photo')
  const [refresh, setRefresh] = useState(0)
  // A remembered student who is no longer on the list is ignored.
  const studentId = students.some((s) => s.id === picked) ? picked : ''
  const bump = () => setRefresh((n) => n + 1)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.page.title')} description={ct('capture.page.description')} />
      {state === 'error' ? (
        <Card>
          <p role="alert">{ct('capture.common.loadFailed')}</p>
          <div>
            <button type="button" className="underline" onClick={reload}>
              {ct('capture.common.retry')}
            </button>
          </div>
        </Card>
      ) : (
        <Card>
          {state === 'loading' && <p role="status">{ct('capture.common.loading')}</p>}
          {state === 'ready' && students.length === 0 && <p>{ct('capture.common.noStudents')}</p>}
          <StudentSelect
            students={students}
            value={studentId}
            onChange={(id) => {
              setPicked(id)
              rememberStudent(id)
            }}
          />
        </Card>
      )}

      {studentId ? (
        <>
          <div role="radiogroup" aria-label={ct('capture.page.kind')} className="flex flex-wrap gap-2">
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
                {ct(k.label)}
              </button>
            ))}
          </div>
          {kind === 'photo' && <PhotoCapture studentId={studentId} onScored={bump} />}
          {kind === 'video' && <VideoCapture key={studentId} studentId={studentId} />}
          {kind === 'note' && <NoteCapture key={studentId} studentId={studentId} />}
          {kind === 'event' && <EaPanel key={studentId} studentId={studentId} />}
        </>
      ) : (
        state === 'ready' && students.length > 0 && <p className="text-muted-foreground">{ct('capture.page.pickStudent')}</p>
      )}

      <section id="to-confirm" aria-labelledby="to-confirm-h" className="flex flex-col gap-4">
        <div>
          <h2 id="to-confirm-h" className="text-h2 font-extrabold">
            {ct('capture.page.toConfirm')}
          </h2>
          <p className="text-muted-foreground">{ct('capture.page.toConfirmHint')}</p>
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
