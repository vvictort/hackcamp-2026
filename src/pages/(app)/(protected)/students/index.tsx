import { RoleGate } from '@/lib/altamira/RoleGate'
import { Link } from 'react-router-dom'
import { UsersRound } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { RoleBadge } from '@/components/students/badges'
import { s } from '@/components/students/text'
import { useLoad } from '@/components/students/useLoad'
import { getMe } from '@/lib/altamira/students-api'
import type { StudentSummary } from '@/server/altamira/contract/api'

function StudentsPageBody() {
  const me = useLoad(getMe, 'me')
  const list: StudentSummary[] = me.status === 'ready' ? [...new Map([...me.data.caseload, ...me.data.students].map((x) => [x.id, x])).values()] : []
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6 lg:gap-8">
      <PageHeader title={s('students.list.title')} description={s('students.list.description')} />
      {me.status === 'loading' && <p role="status" className="text-muted-foreground">{s('students.loading')}</p>}
      {me.status === 'error' && <p role="alert">{me.error.message}</p>}
      {me.status === 'ready' && list.length === 0 && (
        <Card>
          <EmptyState icon={<UsersRound aria-hidden />} title={s('students.list.empty')} description={s('students.list.emptyHelp')} />
        </Card>
      )}
      <ul className="stagger-rise grid gap-4 sm:grid-cols-2">
        {list.map((st) => (
          <li key={st.id}>
            <Link to={`/students/${encodeURIComponent(st.id)}`} className="block rounded-lg">
              <Card className="h-full transition-shadow hover:shadow-lift">
                <span className="text-h2 font-extrabold">{st.firstName ?? st.displayToken}</span>
                <span className="text-small text-muted-foreground">{s('students.grade', { grade: st.grade })}</span>
                <span className="flex flex-wrap gap-2">
                  {st.roles.map((r) => <RoleBadge key={r} role={r} />)}
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function StudentsPage() {
  return (
    <RoleGate path="/students">
      <StudentsPageBody />
    </RoleGate>
  )
}
