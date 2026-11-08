import { MessageSquareText } from 'lucide-react'
import { Card, EmptyState } from '@/components/ui'
import { listParentInput } from '@/lib/altamira/profile-api'
import { fmtDate, s } from './text'
import { useLoad } from './useLoad'

/** Case manager: what parents and guardians sent through the family view. */
export function ParentInputPanel({ studentId }: { studentId: string }) {
  const list = useLoad(() => listParentInput(studentId), studentId)
  const inputs = list.status === 'ready' ? [...list.data.inputs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []
  return (
    <Card title={s('students.parent')}>
      {list.status === 'loading' && <p role="status" className="text-small text-muted-foreground">{s('students.loading')}</p>}
      {list.status === 'error' && <p role="alert" className="text-small">{list.error.message}</p>}
      {list.status === 'ready' && inputs.length === 0 && (
        <EmptyState className="py-8" icon={<MessageSquareText aria-hidden />} title={s('students.parent.empty')} description={s('students.parent.emptyHelp')} />
      )}
      <ul className="flex flex-col gap-3">
        {inputs.map((i) => (
          <li key={i.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <p className="whitespace-pre-wrap">{i.text}</p>
            <p className="text-small text-muted-foreground">{fmtDate(i.createdAt)} - {s('students.parent.lang', { lang: i.language })}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
