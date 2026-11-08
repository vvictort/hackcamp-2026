import { PageHeader } from '@/components/ui'
import { StudentModePanel } from '@/components/capture/StudentModePanel'
import { useCt } from '@/components/capture/useCt'

export default function StudentModePage() {
  const ct = useCt()
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.student.title')} description={ct('capture.student.description')} />
      <StudentModePanel />
    </div>
  )
}
