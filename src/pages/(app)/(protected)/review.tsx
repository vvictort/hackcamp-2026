import { RoleGate } from '@/lib/altamira/RoleGate'
import { PageHeader } from '@/components/ui'
import { ReviewList } from '@/components/capture/ReviewList'
import { useCt } from '@/components/capture/useCt'

function ReviewPageBody() {
  const ct = useCt()
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.review.title')} description={ct('capture.review.description')} />
      <ReviewList />
    </div>
  )
}

export default function ReviewPage() {
  return (
    <RoleGate path="/review">
      <ReviewPageBody />
    </RoleGate>
  )
}
