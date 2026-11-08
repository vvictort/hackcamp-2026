import { FormField, type FormFieldControlProps } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { StudentSummary } from '@/lib/altamyra/role'
import { useLang } from '@/i18n'

export const SELECT_CLASS =
  'flex h-12 w-full rounded-md border border-input bg-card px-3 text-body text-foreground enabled:hover:border-foreground disabled:opacity-60'

export function studentLabel(s: Pick<StudentSummary, 'firstName' | 'displayToken'>, t: ReturnType<typeof useLang>['t']): string {
  return s.firstName ?? t('capture.common.studentFallback', { token: s.displayToken })
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
  const { t } = useLang()
  return (
    <FormField label={t('capture.common.student')}>
      {(control: FormFieldControlProps) => (
        <select {...control} className={cn(SELECT_CLASS)} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('capture.common.chooseStudent')}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {studentLabel(s, t)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  )
}
