/**
 * S13b (D-105, D-110, D-111): a teacher changes her class's theme in Class settings and the classroom
 * applies it; the quote of the day shows on the top bar and can be switched off; the weather widget
 * stays hidden when the weather service cannot be reached (e2e has no network, D-106); the admin home
 * offers "Add classroom". Settings are put back afterwards. Fictional demo data only.
 */
import { expect, test } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

test('teacher class display: theme, quote of the day, weather hidden offline', async ({ browser }) => {
  const ctx = await browser.newContext();
  const teacher = await ctx.newPage();
  // A second session of the same teacher outside classroom mode (the classroom session is PIN-locked for teacher-area calls).
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  let classId: string | null = null;
  let before: { theme: string; quoteEnabled: boolean } | null = null;
  try {
    await login(office, 'english');
    await login(teacher, 'english');
    await ensurePin(teacher);
    const mine = await api(teacher, 'GET', '/api/teacher/contexts');
    const c3a = (mine.body.contexts as Array<{ classId: string; className: string; theme: string; quoteEnabled: boolean }>).find((c) => c.className === '3-A')!;
    classId = c3a.classId;
    before = { theme: c3a.theme, quoteEnabled: c3a.quoteEnabled };

    await teacher.goto('/teacher/classes');
    await teacher.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    const section = teacher.getByTestId('class-display');
    await section.getByTestId('theme-option-animals').click();
    await expect(section.getByTestId('theme-option-animals')).toHaveAttribute('aria-checked', 'true');

    await teacher.goto('/classroom');
    await teacher.getByRole('button', { name: /3-A · English/ }).click();
    await expect(teacher.locator('html')).toHaveAttribute('data-theme', 'animals');
    const quote = teacher.getByTestId('quote-of-the-day').locator('blockquote');
    await expect(quote).toBeVisible();
    const text = await quote.innerText();
    expect(text.length).toBeGreaterThan(10);
    await teacher.reload();
    await expect(teacher.getByTestId('quote-of-the-day').locator('blockquote')).toHaveText(text); // same quote all day
    await expect(teacher.getByTestId('weather')).toHaveCount(0);

    // Switch the quote off for the class.
    expect((await api(office, 'PUT', `/api/teacher/classes/${classId}/display`, { quoteEnabled: false })).status).toBe(200);
    await teacher.reload();
    await expect(teacher.locator('html')).toHaveAttribute('data-theme', 'animals');
    await expect(teacher.getByTestId('quote-of-the-day')).toHaveCount(0);
  } finally {
    if (classId && before) await api(office, 'PUT', `/api/teacher/classes/${classId}/display`, before);
    await ctx.close();
    await officeCtx.close();
  }
});

test('admin home: "Add classroom" opens the new class form', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin');
  await page.getByTestId('admin-quick-actions').getByRole('link', { name: 'Add classroom' }).click();
  await expect(page).toHaveURL(/\/admin\/classes/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});
