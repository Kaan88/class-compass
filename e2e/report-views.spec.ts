/**
 * Report views (S14e1, D-153): choose a built-in view, customise it, save it as a new view, make it
 * the default, fold a section, reload (the view, the default and the fold stay), print opens every
 * section, delete the view; the admin "By class and subject" tab takes the same deep link. Axe on
 * the page with the Customise tree open. Fictional demo data only; the test deletes what it saves.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const sectionKeys = (page: Page) => page.getByTestId('report').locator('details[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));

test('save a customised view, make it the default, fold a section, reload, print, delete', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  // Start clean: no saved views and "Everything" as the default (a rerun after a failure).
  const before = await api(page, 'GET', '/api/teacher/report-views');
  for (const v of before.body.views as Array<{ id: string }>) await api(page, 'DELETE', `/api/teacher/report-views/${v.id}`, {});
  await api(page, 'PUT', '/api/teacher/reports/default-view', { view: 'builtin:everything' });

  await page.goto('/teacher/reports');
  const viewSelect = page.getByLabel('View', { exact: true });
  await expect(viewSelect.locator('option:checked')).toHaveText('Everything ★ default');
  await expect(page.getByTestId('report-view-default')).toHaveText('Default view');
  await expect(page.getByTestId('report')).toBeVisible();
  expect((await sectionKeys(page)).length).toBeGreaterThan(5);

  // A built-in view: only its sections, and the URL says which view.
  await viewSelect.selectOption({ label: 'Attendance & homework' });
  await expect(page).toHaveURL(/view=attendanceHomework/u);
  await expect.poll(() => sectionKeys(page)).toEqual(['overview', 'attendance', 'homework']);

  // Customise: leave out Homework and the attendance weeks, then save as a new view.
  await page.getByRole('button', { name: 'Customise' }).click();
  const tree = page.getByTestId('report-view-tree');
  await expect(tree).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await tree.getByLabel('Homework (whole section)').uncheck();
  await tree.locator('li', { has: page.getByLabel('Attendance (whole section)') }).getByLabel('By week').uncheck();
  await expect.poll(() => sectionKeys(page)).toEqual(['overview', 'attendance']);
  await expect(page.getByText('Changed, not saved yet.')).toBeVisible();
  // The header (printed too) says the sections are no longer the saved view's.
  await expect(page.getByTestId('report-view-name')).toHaveText('View: Attendance & homework (changed, not saved)');
  await page.getByRole('button', { name: 'Save as new view…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as a new view' });
  await dialog.getByLabel('Name of the view').fill('Monday check');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(viewSelect.locator('option:checked')).toHaveText('Monday check');
  await expect(page).toHaveURL(/view=[0-9a-f-]{36}/u);
  await expect(page.getByTestId('report-view-name')).toHaveText('View: Monday check');
  const attendance = page.locator('details[data-section="attendance"]');
  await expect(attendance.getByRole('heading', { name: 'By student' })).toBeVisible();
  await expect(attendance.getByRole('heading', { name: 'By week' })).toHaveCount(0);

  // Make it the default.
  await page.getByRole('button', { name: 'Make default' }).click();
  await expect(page.getByTestId('report-view-default')).toBeVisible();
  await expect(viewSelect.locator('option:checked')).toHaveText('Monday check ★ default');

  // Fold Attendance: its tables are hidden, the title stays.
  await attendance.locator('summary').click();
  await expect(attendance).not.toHaveAttribute('open', '');
  await expect(attendance.getByRole('heading', { name: 'By student' })).toBeHidden();
  // The details' toggle event (which stores the fold) is queued after the click; wait for it before reloading.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('cc.reports.folded.teacher') ?? '')).toContain('attendance');

  // Reload: the view, the default and the fold stay. Without a view in the URL the default opens.
  await page.reload();
  await expect(viewSelect.locator('option:checked')).toHaveText('Monday check ★ default');
  await expect(page.locator('details[data-section="attendance"]')).not.toHaveAttribute('open', '');
  await page.goto('/teacher/reports');
  await expect(viewSelect.locator('option:checked')).toHaveText('Monday check ★ default');
  await expect.poll(() => sectionKeys(page)).toEqual(['overview', 'attendance']);

  // Printing opens every section, and afterwards the fold is back.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('details[data-section="attendance"]')).toHaveAttribute('open', '');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('details[data-section="attendance"]')).not.toHaveAttribute('open', '');

  // Delete the view: the default goes back to Everything.
  await page.getByRole('button', { name: 'Customise' }).click();
  await page.getByRole('button', { name: 'Delete view' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete the view “Monday check”?' });
  await confirm.getByRole('button', { name: 'Delete view' }).click();
  await expect(confirm).toBeHidden();
  await expect(viewSelect.locator('option:checked')).toHaveText('Everything ★ default');
  expect((await api(page, 'GET', '/api/teacher/report-views')).body).toMatchObject({ views: [], defaultView: 'builtin:everything' });
});

test('a mistyped or cut-off date in the link opens the default period instead of breaking the page', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);
  for (const search of ['period=week&from=garbage', 'period=month&from=2026-11', 'period=custom&from=x&to=2026-13-45']) {
    await page.goto(`/teacher/reports?${search}`);
    await expect(page.getByTestId('report')).toBeVisible();
    await expect(page.getByLabel('Period', { exact: true }).locator('option:checked')).toHaveText(search.startsWith('period=week') ? 'Week' : search.startsWith('period=month') ? 'Month' : 'Custom');
  }
});

test('the admin "By class and subject" tab opens from a deep link with the chosen view', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/reports?tab=contexts&view=goalsReflections&period=month');
  await expect(page.getByRole('tab', { name: 'By class and subject', selected: true })).toBeVisible();
  await expect(page.getByLabel('View', { exact: true }).locator('option:checked')).toHaveText('Goals & reflections');
  await expect(page.getByLabel('Period', { exact: true }).locator('option:checked')).toHaveText('Month');
  await expect(page.getByTestId('report')).toBeVisible();
  const keys = await sectionKeys(page);
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) expect(['overview', 'lessonTopics', 'goals', 'studentReflections', 'lessonReflections']).toContain(k);
  expect(await seriousViolations(page)).toEqual([]);
});
