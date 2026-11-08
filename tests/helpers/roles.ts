import type { Page } from '@playwright/test'

export type DemoRole = 'ea' | 'teacher' | 'case_manager' | 'parent' | 'district_lead' | 'school_admin'

/** Nav hrefs each role sees (exact set). */
export const NAV_BY_ROLE: Record<DemoRole, string[]> = {
  ea: ['/home', '/students', '/capture', '/progress', '/summaries', '/settings'],
  teacher: ['/home', '/students', '/capture', '/progress', '/summaries', '/settings'],
  case_manager: ['/home', '/students', '/progress', '/summaries', '/settings'],
  parent: ['/family', '/settings'],
  district_lead: ['/insights', '/settings'],
  school_admin: ['/admin/tickets', '/admin/roles', '/settings'],
}

export const REMOVED_PATHS = ['/lesson-lens', '/review', '/ea', '/drafts']

/** Load the fictional demo once (a second call answers 400, which is fine). */
export async function ensureSeed(page: Page) {
  await page.request.post('/api/v1/dev/seed', { data: {} })
}

/** Dev only: act as `role` (needs ALTAMIRA_DEV_SEED=true), then open `path`. */
export async function actAs(page: Page, role: DemoRole, path = '/home') {
  const res = await page.request.post('/api/v1/dev/role', { data: { role } })
  if (!res.ok()) throw new Error(`dev/role ${role} -> ${res.status()}`)
  await page.goto(path)
}

/** Sorted set of internal hrefs in the sidebar, excluding the logo link. */
export async function navHrefs(page: Page): Promise<string[]> {
  const hrefs = await page
    .getByTestId('app-navigation')
    .locator('a[href^="/"]')
    .evaluateAll((els) => els.map((e) => new URL((e as HTMLAnchorElement).href).pathname))
  return [...new Set(hrefs)].filter((h) => h !== '/').sort()
}
