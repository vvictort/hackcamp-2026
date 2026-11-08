/**
 * Accessibility audit: axe-core on the main pages as a seeded case manager,
 * failing on serious or critical violations. Needs a test account:
 *   npx deepspace test accounts list
 * and a local server with ALTAMIRA_DEV_SEED=true (the secrets config holds it).
 * Run:  npx deepspace test run a11y
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

test.skip(loadAllTestAccounts().length < 1, 'Needs 1 usable test account: npx deepspace test accounts create ...')

const PAGES = ['/home', '/students', '/lesson-lens', '/capture', '/review', '/ea', '/drafts', '/family', '/insights']

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test.describe('axe: no serious or critical issues', () => {
  test.beforeEach(async ({ users }) => {
    const [u] = await users(1)
    await u.page.goto('/home')
    await expect(u.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    const load = u.page.getByRole('button', { name: 'Load demo data' })
    if (await load.isVisible().catch(() => false)) {
      await load.click()
      await u.page.waitForTimeout(1500)
    }
  })

  for (const path of PAGES) {
    test(path, async ({ users }) => {
      const [u] = await users(1)
      await u.page.goto(path)
      await u.page.waitForLoadState('networkidle')
      expect(await violations(u.page)).toEqual([])
    })
  }

  test('/students/[id]', async ({ users }) => {
    const [u] = await users(1)
    await u.page.goto('/students')
    const link = u.page.locator('a[href^="/students/"]').first()
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()
    await u.page.waitForLoadState('networkidle')
    expect(await violations(u.page)).toEqual([])
  })
})
