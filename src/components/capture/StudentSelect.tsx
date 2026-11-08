import { FormField, type FormFieldControlProps } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { StudentSummary } from './useStudents'
import { useCt } from './useCt'

export const SELECT_CLASS =
  'flex h-12 w-full rounded-md border border-input bg-card px-3 text-body text-foreground enabled:hover:border-foreground disabled:opacity-60'

export function studentLabel(s: StudentSummary, ct: ReturnType<typeof useCt>): string {
  return s.firstName ?? ct('capture.common.studentFallback', { token: s.displayToken })
}

/** Native select (fully keyboard operable) styled like the design-system inputs. */
export function StudentSelect({
  students,
  value,
  onChange,
}: {
  students: StudentSummary[]
  value: string
  onChange: (id: string) => void
}) {
  const ct = useCt()
  return (
    <FormField label={ct('capture.common.student')}>
      {(control: FormFieldControlProps) => (
        <select {...control} className={cn(SELECT_CLASS)} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{ct('capture.common.chooseStudent')}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {studentLabel(s, ct)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  )
}
