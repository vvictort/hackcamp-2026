import { describe, expect, it } from 'vitest'
import { nav } from '@/nav'
import { canOpen, START_PATH } from './RoleGate'

describe('role access by route', () => {
  it('student-era routes are gone', () => {
    const paths = nav.map((n) => n.path)
    for (const gone of ['/drafts', '/student-mode']) expect(paths).not.toContain(gone)
  })
  it('lets each role into its own pages only', () => {
    expect(canOpen('/capture', 'ea')).toBe(true)
    expect(canOpen('/capture', 'case_manager')).toBe(false)
    expect(canOpen('/end-of-day', 'ea')).toBe(true)
    expect(canOpen('/end-of-day', 'case_manager')).toBe(false)
    expect(canOpen('/summaries', 'case_manager')).toBe(true)
    expect(canOpen('/summaries', 'parent')).toBe(false)
    expect(canOpen('/progress', 'teacher')).toBe(true)
    expect(canOpen('/progress', 'district_lead')).toBe(false)
    expect(canOpen('/admin/tickets', 'school_admin')).toBe(true)
    expect(canOpen('/admin/tickets', 'case_manager')).toBe(false)
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
    const staff = ['/home', '/students', '/capture', '/progress', '/summaries', '/settings']
    expect(items('ea')).toEqual(staff)
    expect(items('teacher')).toEqual(staff)
    expect(items('case_manager')).toEqual(['/home', '/students', '/progress', '/summaries', '/settings'])
    expect(items('parent')).toEqual(['/family', '/settings'])
    expect(items('district_lead')).toEqual(['/insights', '/settings'])
    expect(items('school_admin')).toEqual(['/admin/tickets', '/admin/roles', '/settings'])
  })
  it('has no duplicate paths and none of the removed screens', () => {
    const paths = nav.map((n) => n.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const gone of ['/lesson-lens', '/review', '/ea']) expect(paths).not.toContain(gone)
  })
  it('each role starts on a page it may open', () => {
    for (const [role, path] of Object.entries(START_PATH)) expect(canOpen(path, role as keyof typeof START_PATH)).toBe(true)
  })
})
