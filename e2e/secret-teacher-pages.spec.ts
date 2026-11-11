/**
 * S20a missing automated checks (S7: SEC-1, SEC-6, AST-2, AST-3; UX-1): the Secret Students and Daily
 * Assistant teacher pages on the classroom display and the mobile project (Pixel 7): the Secret
 * Students page (draw size setting, history) and the assistant page's three tabs (week, settings,
 * history) render without sideways page scroll and pass axe (serious and critical). Then the
 * assistant week's print view: the class choice, week buttons, tabs and editing tools are hidden and
 * the week's table is printed. Read-only on the demo data (nothing is saved).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensurePin, login } from './helpers.ts';

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const sidewaysScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth + 1);

test('Secret Students and Daily Assistant teacher pages: no sideways scroll, axe @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);

  await page.goto('/teacher/secret');
  const secret = page.getByTestId('secret-page');
  await expect(secret).toBeVisible();
  await expect(secret.getByRole('heading', { name: 'Secret Students', level: 1 })).toBeVisible();
  await expect(secret.getByLabel('Class', { exact: true })).toBeVisible();
  await expect(secret.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(secret.getByRole('table').first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/teacher/assistant');
  const ap = page.getByTestId('assistant-page');
  await expect(ap).toBeVisible();
  for (const tab of ['Week', 'Settings', 'History']) {
    await ap.getByRole('tab', { name: tab }).click();
    await expect(ap.getByRole('tab', { name: tab, selected: true })).toBeVisible();
    await expect(ap.getByRole('tabpanel')).toBeVisible();
    // Wait for the tab's data (the loading line goes away).
    await expect(ap.getByRole('tabpanel').getByText('Loading…')).toHaveCount(0);
    expect(await sidewaysScroll(page), tab).toBe(false);
    expect(await seriousViolations(page), tab).toEqual([]);
  }
});

test('print: the assistant week prints the table without the class choice, week buttons, tabs or tools', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/teacher/assistant');
  const ap = page.getByTestId('assistant-page');
  await expect(ap.getByRole('tab', { name: 'Week', selected: true })).toBeVisible();
  const sheet = ap.locator('.cc-print-sheet');
  await expect(sheet.getByRole('table')).toBeVisible();
  await expect(ap.getByRole('button', { name: 'Print' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  try {
    await expect(page.locator('.cc-topbar')).toBeHidden();
    await expect(ap.getByLabel('Class', { exact: true })).toBeHidden();
    await expect(ap.getByRole('tablist')).toBeHidden();
    await expect(ap.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(ap.getByRole('button', { name: 'Next week' })).toBeHidden();
    await expect(sheet).toBeVisible();
    const table = sheet.getByRole('table');
    await expect(table).toBeVisible();
    // Header row plus the school days of the week, each with some height on paper.
    expect(await table.getByRole('row').count()).toBeGreaterThan(1);
    expect((await sheet.boundingBox())!.height).toBeGreaterThan(100);
    const pdf = await page.pdf({ printBackground: true });
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/gu) ?? [];
    expect(pages.length).toBeGreaterThan(0);
  } finally {
    await page.emulateMedia({ media: 'screen' });
  }
});
