/**
 * S22d (D-178): Compact / Normal / Large in the teacher and admin areas (UX-6, THM-6). The account's
 * choice in Profile → Spacing changes table row height and card padding; buttons keep their size
 * (touch targets never shrink, also on the touch phone); axe stays clean; the classroom screen keeps its
 * own size. The demo accounts are put back to Normal in `finally` (the suite shares one database).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

type Density = 'compact' | 'normal' | 'large';

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

/** Choose the spacing on the Profile page as a person would. */
async function chooseSpacing(page: Page, profile: string, density: Density) {
  await page.goto(profile);
  await expect(page.getByTestId('profile-page')).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/auth/preferences') && r.request().method() === 'PATCH');
  await page.getByLabel('Spacing').selectOption(density);
  expect((await saved).status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-area-density', density);
}

const height = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);
const cardPadding = (page: Page) => page.getByTestId('profile-page').locator('.cc-card').first().evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
/** Heights of the Profile page's buttons, by their accessible text. */
const buttonHeights = (page: Page) =>
  page
    .getByTestId('profile-page')
    .locator('.cc-btn:visible')
    .evaluateAll((els) => els.map((el) => [el.textContent?.trim() ?? '', Math.round(el.getBoundingClientRect().height)] as const));

test('admin: Spacing changes the audit table row height and card padding, buttons keep their size, axe clean', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  try {
    const rows: Record<string, number> = {};
    const pads: Record<string, number> = {};
    const buttons: Record<string, ReadonlyArray<readonly [string, number]>> = {};
    for (const density of ['normal', 'compact', 'large'] as const) {
      await chooseSpacing(page, '/admin/profile', density);
      pads[density] = await cardPadding(page);
      buttons[density] = await buttonHeights(page);
      expect(await seriousViolations(page), `Profile at ${density}`).toEqual([]);
      await page.goto('/admin/audit');
      await expect(page.locator('html')).toHaveAttribute('data-area-density', density);
      await expect(page.locator('.cc-table tbody tr').first()).toBeVisible();
      rows[density] = await height(page, '.cc-table tbody tr');
      expect(await seriousViolations(page), `Audit log at ${density}`).toEqual([]);
    }
    expect(rows.compact).toBeLessThan(rows.normal!);
    expect(rows.large).toBeGreaterThan(rows.normal!);
    // Normal is the look before S22d: 1.25rem card padding (18 px root at 100 % text).
    expect(pads.normal).toBeCloseTo(1.25 * 18, 0);
    expect(pads.compact).toBeLessThan(pads.normal!);
    expect(pads.large).toBeGreaterThan(pads.normal!);
    // Touch targets keep their size at every density.
    expect(buttons.compact).toEqual(buttons.normal);
    expect(buttons.large).toEqual(buttons.normal);
    expect(buttons.normal!.length).toBeGreaterThan(0);
  } finally {
    expect((await api(page, 'PATCH', '/api/auth/preferences', { density: 'normal' })).status).toBe(200);
  }
});

test('teacher: Spacing follows the account into the teacher area but not onto the classroom screen', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  try {
    await chooseSpacing(page, '/teacher/profile', 'compact');
    await page.goto('/teacher/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-area-density', 'compact');
    expect(await seriousViolations(page)).toEqual([]);
    // Stored for the account: a reload keeps it.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-area-density', 'compact');
    // The classroom screen sizes its own cards (D-177, D-195) and never carries the area density.
    await page.goto('/classroom');
    await expect(page.getByTestId('classroom-shell')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-area-density', /./u);
  } finally {
    expect((await api(page, 'PATCH', '/api/auth/preferences', { density: 'normal' })).status).toBe(200);
  }
});

test('phone: Compact never shrinks a touch target below --cc-touch @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  try {
    await chooseSpacing(page, '/teacher/profile', 'normal');
    const normal = await buttonHeights(page);
    await chooseSpacing(page, '/teacher/profile', 'compact');
    expect(await buttonHeights(page)).toEqual(normal);
    const touch = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.height = 'var(--cc-touch)';
      document.body.append(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    });
    const select = await page.getByLabel('Spacing').evaluate((el) => el.getBoundingClientRect().height);
    expect(select).toBeGreaterThanOrEqual(touch - 1);
    expect(await seriousViolations(page)).toEqual([]);
  } finally {
    expect((await api(page, 'PATCH', '/api/auth/preferences', { density: 'normal' })).status).toBe(200);
  }
});
