/**
 * In-app Help (user documentation, ROADMAP "User documentation"): the bundled guides open from the
 * teacher menu, the admin top bar and the student page, in the interface language, with a switch to
 * the other language. Each view renders the guide's heading and its screenshots and has no axe
 * violation of impact "serious" or "critical". Fictional demo data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

/** The first screenshot of the guide has loaded (bundled, same origin). */
async function expectImageLoaded(guide: Locator) {
  const img = guide.locator('img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(await img.getAttribute('src')).not.toMatch(/^https?:/u);
}

test('teachers open Help from the teacher navigation in English and Turkish', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  // The menu page has no link row (its tiles are the navigation); every other teacher page has Help.
  await page.goto('/teacher');
  await page.getByTestId('teacher-menu').getByRole('link', { name: 'Profile and PIN' }).click();
  await page.getByTestId('help-link').first().click();
  await expect(page).toHaveURL(/\/help\?guide=teacher/u);
  const guide = page.getByTestId('guide');
  await expect(guide.getByRole('heading', { name: 'Teacher guide', level: 1 })).toBeVisible();
  await expect(guide).toHaveAttribute('lang', 'en');
  await expectImageLoaded(guide);
  expect(await seriousViolations(page)).toEqual([]);

  // A link to another guide opens it inside Help.
  await guide.getByRole('link', { name: 'quick start for teachers' }).click();
  await expect(guide.getByRole('heading', { name: 'Quick start for teachers', level: 1 })).toBeVisible();

  // The language switch shows the Turkish guide.
  await page.getByRole('group', { name: 'Guide language' }).getByRole('button', { name: 'Türkçe' }).click();
  await expect(page).toHaveURL(/lang=tr/u);
  await expect(guide.getByRole('heading', { name: 'Öğretmenler için hızlı başlangıç', level: 1 })).toBeVisible();
  await expect(guide).toHaveAttribute('lang', 'tr');

  // The whole page follows the guide language (D-142): guide list and top bar too.
  await expect(page.getByRole('navigation', { name: 'Kılavuzlar' }).getByRole('link', { name: 'Hızlı başlangıç: öğretmenler' })).toBeVisible();
  // Numbered steps keep their numbers (Tailwind's preflight removes list markers).
  expect(await guide.locator('ol').first().evaluate((el) => getComputedStyle(el).listStyleType)).toBe('decimal');

  await page.goto('/help?guide=teacher&lang=tr');
  await expect(guide.getByRole('heading', { name: 'Öğretmen kılavuzu', level: 1 })).toBeVisible();
  await expectImageLoaded(guide);
  // Each picture opens full size in a new tab.
  await expect(guide.locator('.cc-guide__figure a').first()).toHaveAttribute('target', '_blank');
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('link', { name: 'Sınıf Pusulası’na dön' }).click();
  await expect(page).toHaveURL(/\/teacher/u);
});

test('administrators open Help from the admin top bar in English and Turkish', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  await page.goto('/admin');
  await page.getByTestId('help-link').click();
  const guide = page.getByTestId('guide');
  await expect(guide.getByRole('heading', { name: 'Administrator guide', level: 1 })).toBeVisible();
  await expectImageLoaded(guide);
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/help?guide=admin&lang=tr');
  await expect(guide.getByRole('heading', { name: 'Yönetici kılavuzu', level: 1 })).toBeVisible();
  await expectImageLoaded(guide);
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/help?guide=super-speakers&lang=tr');
  await expect(guide.getByRole('heading', { name: 'Süper Konuşmacılar: yöneticiler için kılavuz', level: 1 })).toBeVisible();
  // An unknown guide falls back to the guide for the role.
  await page.goto('/help?guide=nope&lang=en');
  await expect(guide.getByRole('heading', { name: 'Administrator guide', level: 1 })).toBeVisible();
});

test('students open Help on their own page', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  const ctx = mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string }>;
  const url = await studentLinkUrl(page, ctx.classId, roster[6]!.id);

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const p = await phone.newPage();
  try {
    await p.goto(url);
    await expect(p.getByTestId('student-page')).toBeVisible();
    await p.getByRole('button', { name: 'Help', exact: true }).click();
    const panel = p.getByTestId('help-panel');
    await expect(panel.getByRole('heading', { level: 1 })).toContainText('Your own page in Class Compass');
    await expectImageLoaded(panel.getByTestId('guide'));
    expect(await seriousViolations(p)).toEqual([]);
    await panel.getByRole('button', { name: 'Back to the page' }).first().click();
    await expect(p.getByTestId('student-page')).toBeVisible();
  } finally {
    await phone.close();
  }
});

test('on a phone the guide list folds into one line and the guide opens in view (D-142) @mobile', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'phone layout');
  test.setTimeout(120_000);
  await login(page, 'english');
  await page.goto('/help?guide=teacher&lang=en');
  const guide = page.getByTestId('guide');
  const heading = guide.getByRole('heading', { name: 'Teacher guide', level: 1 });
  await expect(heading).toBeVisible();
  const fold = page.getByTestId('help-toc-fold');
  await expect(fold).toBeVisible();
  await expect(fold.getByRole('link', { name: 'Administrator guide' })).toBeHidden();
  // The guide's heading is on the first screen.
  const box = await heading.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height);
  await fold.locator('summary').click();
  await fold.getByRole('link', { name: 'Quick start: teachers' }).click();
  await expect(guide.getByRole('heading', { name: 'Quick start for teachers', level: 1 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
