import { RoleGate } from '@/lib/altamira/RoleGate'
import { PageHeader } from '@/components/ui'
import { EaPanel } from '@/components/capture/EaPanel'
import { useCt } from '@/components/capture/useCt'

function EaPageBody() {
  const ct = useCt()
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.ea.title')} description={ct('capture.ea.description')} />
      <EaPanel />
    </div>
  )
}

export default function EaPage() {
  return (
    <RoleGate path="/ea">
      <EaPageBody />
    </RoleGate>
  )
}
