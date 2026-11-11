/**
 * S20a missing automated checks (RPT-1, RPT-4, OPS-*, ENG-3, ENG-4): the teacher Reports page, Admin →
 * Reports and Admin → Maintenance with the demo seed, on the classroom display (1920×1080) and on the
 * mobile project (Pixel 7): the main headings and tables, one interaction on each page (the report
 * period, the admin report tab, a maintenance tab), no sideways page scroll and no serious or critical
 * axe violation. Then the print layout of a report (teacher and admin): navigation, filters and the
 * view bar are hidden, the school name printed in the header appears, every section opens and has
 * content, and the PDF has pages. Read-only on the demo data (nothing is saved).
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

/** The page itself never scrolls sideways (wide tables scroll inside `.cc-table-wrap`). */
const sidewaysScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth + 1);

/**
 * The report's sections: open or folded, and their body under the summary (the summary alone is a
 * touch target tall, so the body is measured on its own: its height and its rendered text, a table
 * cell or a chart counting as content).
 */
const sectionBodies = (page: Page) =>
  page
    .getByTestId('report')
    .locator('details[data-section]')
    .evaluateAll((els) =>
      els.map((e) => {
        const body = e.querySelector<HTMLElement>(':scope > section');
        const shown = body && getComputedStyle(body).display !== 'none' && getComputedStyle(body).visibility !== 'hidden';
        return {
          key: e.getAttribute('data-section'),
          open: (e as HTMLDetailsElement).open,
          bodyH: shown ? body.getBoundingClientRect().height : 0,
          bodyText: shown ? body.innerText.trim().length : 0,
          bodyParts: shown ? body.querySelectorAll('table, svg, img, canvas').length : 0,
        };
      }),
    );

test('teacher Reports: heading, report tables, period change, axe @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/teacher/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  const report = page.getByTestId('report');
  await expect(report).toBeVisible();
  await expect(report.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(report.getByRole('table').first()).toBeVisible();
  expect((await sectionBodies(page)).length).toBeGreaterThan(0);

  // One interaction: the period. The link says which period, and the report data follows: the range
  // in the report header (from the server's `from`/`to`) changes.
  const range = report.locator('header > p.cc-muted').first();
  await expect(range).toContainText(/\d/u);
  const before = await range.innerText();
  const period = page.getByLabel('Period', { exact: true });
  await expect(period.locator('option:checked')).not.toHaveText('Month');
  await period.selectOption({ label: 'Month' });
  await expect(page).toHaveURL(/period=month/u);
  await expect(period.locator('option:checked')).toHaveText('Month');
  await expect(range).not.toHaveText(before);
  await expect(report).toBeVisible();
  await expect(report.getByRole('table').first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);
});

test('admin Reports: usage tables, the "By class and subject" tab, axe @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'School-wide usage', selected: true })).toBeVisible();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('table').first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('tab', { name: 'By class and subject' }).click();
  await expect(page.getByRole('tab', { name: 'By class and subject', selected: true })).toBeVisible();
  await expect(page).toHaveURL(/tab=contexts/u);
  const report = page.getByTestId('report');
  await expect(report).toBeVisible();
  await expect(report.getByRole('table').first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);
});

test('admin Maintenance: backups, the Exports tab, axe @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  await page.goto('/admin/maintenance');
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Backups', selected: true })).toBeVisible();
  const panel = page.getByRole('tabpanel', { name: 'Backups' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Last local backup')).toBeVisible();
  await expect(panel.getByText('App version')).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('tab', { name: 'Exports' }).click();
  await expect(page.getByRole('tab', { name: 'Exports', selected: true })).toBeVisible();
  const exports = page.getByRole('tabpanel', { name: 'Exports' });
  await expect(exports).toBeVisible();
  await expect(exports.getByRole('button').first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(false);
  expect(await seriousViolations(page)).toEqual([]);
});

/** Print media on a report page: no navigation or filters, the report with every section open and not blank. */
async function checkReportPrint(page: Page) {
  const report = page.getByTestId('report');
  await expect(report).toBeVisible();
  // `beforeprint` opens every folded section (S14e1); the print media query hides the rest.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  try {
    for (const nav of await page.locator('nav, .cc-nav, .cc-topbar').all()) await expect(nav).toBeHidden();
    await expect(page.locator('.cc-report-filters')).toBeHidden();
    await expect(page.locator('.cc-report-viewbar')).toBeHidden();
    await expect(page.getByRole('tablist')).toBeHidden();
    await expect(report).toBeVisible();
    // The header printed only on paper (school name, when it was made) shows.
    await expect(report.locator('.cc-print-only').first()).toBeVisible();
    const box = (await report.boundingBox())!;
    expect(box.height).toBeGreaterThan(200);
    const sections = await sectionBodies(page);
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect(s.open, `${s.key} open in print`).toBe(true);
      expect(s.bodyH, `${s.key}: its body has height in print`).toBeGreaterThan(0);
      expect(s.bodyText + s.bodyParts, `${s.key}: its body shows text, a table or a chart in print`).toBeGreaterThan(0);
    }
    // The PDF the browser would print: at least one page, A4 from the named @page rule.
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/gu) ?? [];
    expect(pages.length).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'printed pages', description: `${page.url()}: ${pages.length}` });
  } finally {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  }
}

test('print: the teacher and admin report print layouts hide navigation and keep the content', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/teacher/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await checkReportPrint(page);

  await login(page, 'admin');
  await page.goto('/admin/reports?tab=contexts');
  await expect(page.getByRole('tab', { name: 'By class and subject', selected: true })).toBeVisible();
  await checkReportPrint(page);
});
