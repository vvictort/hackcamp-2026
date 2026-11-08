import { PageHeader } from '@/components/ui'
import { EaPanel } from '@/components/capture/EaPanel'
import { useCt } from '@/components/capture/useCt'

export default function EaPage() {
  const ct = useCt()
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.ea.title')} description={ct('capture.ea.description')} />
      <EaPanel />
    </div>
  )
}
