/**
 * The public privacy page (S32, D-209): `/privacy` opens without an account, in English and Turkish,
 * says what Sign in with Google receives, fits a phone, and has no axe violation of impact "serious"
 * or "critical".
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('the privacy page is public, in English and Turkish, and passes axe @mobile', async ({ page }) => {
  await page.goto('/privacy');
  // Signed out: the page stays, it does not send the visitor to the sign-in page.
  await expect(page).toHaveURL(/\/privacy$/u);
  const main = page.getByTestId('privacy-page');
  await expect(main.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Signing in' })).toBeVisible();
  await expect(main).toContainText('your email address');
  await expect(main).toContainText('no contacts, no mail, no files');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(main.getByRole('heading', { level: 1, name: 'Gizlilik' })).toBeVisible();
  await expect(main).toContainText('e-posta adresiniz');
  expect(await seriousViolations(page)).toEqual([]);

  // The way to the sign-in page is one link away.
  await page.getByRole('link', { name: /Giriş yap|Sign in/u }).click();
  await expect(page).toHaveURL(/\/login/u);
});
