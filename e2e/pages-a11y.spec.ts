/**
 * S13a housekeeping (8b): Playwright + axe for the pages that had no browser test yet — teacher Goals,
 * Student links (with the printable link cards), teacher Reports, admin Reports, Maintenance and the
 * school-year rollover wizard. Fictional demo data only. Each page must render its heading and have
 * no axe violation of impact "serious" or "critical".
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

async function seriousViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('teacher pages: Goals, Student links with print cards, Reports pass axe', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);

  await page.goto('/teacher/goals');
  await expect(page.getByTestId('goals-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/teacher/student-links');
  const links = page.getByTestId('links-page');
  await expect(links).toBeVisible();
  await links.getByLabel('Class', { exact: true }).selectOption({ label: '2-D' });
  await expect(links.getByTestId('link-row').first()).toBeVisible();
  const make = links.getByRole('button', { name: /^Make (links|a link) for/ });
  if (await make.isEnabled()) await make.click();
  // The printable cards for the links just made (QR + address), shown on screen and printed.
  await expect(links.getByTestId('link-cards')).toBeVisible();
  await expect(links.getByTestId('link-card').first()).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.emulateMedia({ media: 'print' });
  await expect(links.getByTestId('link-cards')).toBeVisible();
  await expect(links.getByTestId('link-list')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });

  await page.goto('/teacher/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('admin pages: Reports, Maintenance and the rollover wizard pass axe', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');

  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/admin/maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible();
  // Bug 8a: the maintenance overview reads from the backup runs (never shows an error here).
  const status = await api(page, 'GET', '/api/admin/maintenance');
  expect(status.status).toBe(200);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('tab', { name: 'New school year' }).click();
  await expect(page.getByRole('tabpanel')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
