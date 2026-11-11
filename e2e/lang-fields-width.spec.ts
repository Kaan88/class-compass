/**
 * S25a (D-185; ROADMAP "Found by the crawl (S20d)"): a language field has a readable maximum width.
 * On a 1920 px screen a one-language class's homework status field ("Not yet") was about 1,500 px wide,
 * with its "Counts as" choice pushed to the far edge. Now, in Class settings for 3-A · English:
 * - one language: the status field is at most about 40 characters wide and "Counts as" stays beside it;
 *   the goal outcome fields are as narrow;
 * - two languages: both fields side by side, each as narrow, "Counts as" still beside them;
 * - on a 375 px phone the fields fit the screen.
 * The class language is put back in `finally` (the e2e suite shares one database). Fictional demo data.
 */
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string }; mainLanguage: 'en' | 'tr'; secondLanguageEnabled: boolean };

/** Readable: 40 characters of the body font are well under this (about 350 px at 100 % text). */
const MAX_FIELD = 480;
/** "Counts as" beside the field: the row gap and nothing more than a little slack. */
const MAX_GAP = 48;

async function boxes(page: Page, n: number) {
  const status = page.getByTestId('homework-status').nth(n);
  const inputs = status.locator('input');
  const select = page.getByLabel(`Counts as (status ${n + 1})`);
  await expect(select).toBeVisible();
  const fields = await inputs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  const s = (await select.boundingBox())!;
  return { fields, select: s };
}

test('language fields keep a readable width and their neighbour beside them at 1920 px, with one or two languages (S25a, D-185, D-172, UX-6)', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'checked once, on the display project');
  await login(page, 'english');
  await ensurePin(page);
  const ctx = ((await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  const before = { mainLanguage: ctx.mainLanguage, secondLanguageEnabled: ctx.secondLanguageEnabled };
  const setLanguage = async (secondLanguageEnabled: boolean) =>
    expect((await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled })).status).toBe(200);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const two of [false, true]) {
      await setLanguage(two);
      await page.goto('/teacher/classes');
      await page.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
      const label = two ? 'two languages' : 'one language';
      const { fields, select } = await boxes(page, 1);
      expect(fields.length, `${label}: fields`).toBe(two ? 2 : 1);
      for (const f of fields) expect(f.width, `${label}: field width`).toBeLessThanOrEqual(MAX_FIELD);
      if (two) expect(Math.abs(fields[0]!.top - fields[1]!.top), `${label}: side by side`).toBeLessThan(2);
      const right = Math.max(...fields.map((f) => f.right));
      expect(select.x - right, `${label}: "Counts as" beside the field`).toBeLessThanOrEqual(MAX_GAP);
      expect(select.x - right, `${label}: "Counts as" after the field`).toBeGreaterThanOrEqual(0);
      // The goal outcomes (a list of fields alone in their rows) are as narrow.
      const outcome = page.getByTestId('goals-outcome').first().locator('input').first();
      await expect(outcome).toBeVisible();
      expect((await outcome.boundingBox())!.width, `${label}: goal outcome width`).toBeLessThanOrEqual(MAX_FIELD);
    }
    // A phone: the fields fit the screen (two languages wrap one under the other).
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId('homework-status').nth(1).scrollIntoViewIfNeeded();
    const phone = await page.getByTestId('homework-status').nth(1).locator('input').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    for (const f of phone) {
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.right).toBeLessThanOrEqual(375);
      expect(f.width, 'phone field width').toBeGreaterThan(200);
    }
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth + 1), 'no sideways scroll at 375 px').toBe(true);
  } finally {
    await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, before);
  }
});
