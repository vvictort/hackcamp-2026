import { PageHeader } from '@/components/ui'
import { ReviewList } from '@/components/capture/ReviewList'
import { useCt } from '@/components/capture/useCt'

export default function ReviewPage() {
  const ct = useCt()
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={ct('capture.review.title')} description={ct('capture.review.description')} />
      <ReviewList />
    </div>
  )
}
