/**
 * Design system (THM-1..6, UX-6/7, ENG-4): the catalog renders every theme × language, the 20-card
 * grid fits one 1920×1080 classroom screen, 34 cards stay usable, text can grow to 200 %, and pages
 * pass axe checks (including colour contrast). Few sign-ins on purpose (login is rate limited).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers.ts';

const seriousViolations = async (page: Page, include?: string[]) => {
  let builder = new AxeBuilder({ page });
  for (const sel of include ?? []) builder = builder.include(sel);
  const r = await builder.analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
};

test('catalog: every theme × language, grids for 20 and 34 students, 200 % text', async ({ page }) => {
  await login(page, 'english');
  await page.goto('/dev/catalog');
  for (const theme of ['explorer', 'animals', 'classroom']) {
    for (const loc of ['en', 'tr']) {
      const panel = page.getByTestId(`catalog-${theme}-${loc}`);
      await expect(panel).toBeVisible();
      await expect(panel.locator('.cc-student-card')).toHaveCount(5);
    }
  }
  await expect(page.getByTestId('catalog-animals-tr')).toContainText('Sınıra ulaştı');
  await expect(page.getByTestId('catalog-animals-en')).toContainText('Limit reached');

  await page.getByLabel('Themes').selectOption('classroom');
  const g20 = page.getByTestId('catalog-grid-20');
  await expect(g20.locator('.cc-student-card')).toHaveCount(20);
  expect((await g20.boundingBox())!.height).toBeLessThan(760); // room left for banner + counter on 1080p
  const g34 = page.getByTestId('catalog-grid-34');
  // Kept as test artifacts for visual review of the classroom layouts.
  await g20.screenshot({ path: test.info().outputPath('grid-20.png') });
  await g34.screenshot({ path: test.info().outputPath('grid-34.png') });
  await expect(g34.locator('.cc-student-grid')).toHaveAttribute('data-density', 'compact');
  expect((await g34.boundingBox())!.height).toBeLessThan(800);
  await expect(g20.getByText('Absent').first()).toBeVisible(); // text, not colour only (UX-7)
  const add = (await g20.locator('.cc-student-card__add').first().boundingBox())!;
  expect(Math.min(add.width, add.height)).toBeGreaterThanOrEqual(56); // large touch target (UX-6)

  await page.getByLabel('Text size').selectOption('200');
  await expect(page.locator('html')).toHaveAttribute('style', /--cc-text-scale:\s*2/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByLabel('Text size').selectOption('100');

  // axe (WCAG incl. colour contrast) on each theme in both languages.
  for (const theme of ['explorer', 'animals', 'classroom'] as const) {
    await page.getByLabel('Themes').selectOption(theme);
    await expect(page.getByTestId(`catalog-${theme}-en`)).toBeVisible();
    expect(await seriousViolations(page, [`[data-testid="catalog-${theme}-en"]`, `[data-testid="catalog-${theme}-tr"]`])).toEqual([]);
  }
});

test('axe: sign-in page and teacher menu', async ({ page }) => {
  await page.goto('/login');
  expect(await seriousViolations(page)).toEqual([]);
  await login(page, 'english');
  await page.goto('/teacher');
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
