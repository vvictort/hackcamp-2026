import { RoleGate } from '@/lib/altamira/RoleGate'
import { PageHeader } from '@/components/ui'
import { PhotoCapture } from '@/components/capture/PhotoCapture'
import { useCt } from '@/components/capture/useCt'

function CapturePageBody() {
  const ct = useCt()
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.photo.title')} description={ct('capture.photo.description')} />
      <PhotoCapture />
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
