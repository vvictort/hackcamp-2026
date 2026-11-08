import { describe, expect, it } from 'vitest'
import { nav } from '@/nav'
import { canOpen } from './RoleGate'

describe('role access by route', () => {
  it('student-era routes are gone', () => {
    const paths = nav.map((n) => n.path)
    for (const gone of ['/drafts', '/student-mode']) expect(paths).not.toContain(gone)
  })
  it('lets each role into its own pages only', () => {
    expect(canOpen('/capture', 'ea')).toBe(true)
    expect(canOpen('/capture', 'case_manager')).toBe(false)
    expect(canOpen('/review', 'case_manager')).toBe(false)
    expect(canOpen('/lesson-lens', 'ea')).toBe(false)
    expect(canOpen('/family', 'parent')).toBe(true)
    expect(canOpen('/family', 'case_manager')).toBe(false)
    expect(canOpen('/insights', 'district_lead')).toBe(true)
    expect(canOpen('/students', 'district_lead')).toBe(false)
    expect(canOpen('/students', 'parent')).toBe(false)
    expect(canOpen('/admin/roles', 'school_admin')).toBe(true)
    expect(canOpen('/admin/roles', 'teacher')).toBe(false)
    expect(canOpen('/settings', null)).toBe(true)
  })
  it('sidebar items per role', () => {
    const items = (r: Parameters<typeof canOpen>[1]) => nav.filter((n) => !n.hidden && canOpen(n.path, r)).map((n) => n.path)
    expect(items('ea')).toEqual(['/home', '/students', '/capture', '/review', '/settings'])
    expect(items('teacher')).toEqual(['/home', '/students', '/lesson-lens', '/capture', '/review', '/settings'])
    expect(items('case_manager')).toEqual(['/home', '/students', '/settings'])
    expect(items('parent')).toEqual(['/family', '/settings'])
    expect(items('district_lead')).toEqual(['/insights', '/settings'])
    expect(items('school_admin')).toEqual(['/admin/roles', '/settings'])
  })
})
