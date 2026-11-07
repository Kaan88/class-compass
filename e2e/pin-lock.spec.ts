/**
 * Presentation-safe teacher area (PIN-1..9, ENG-3 "teacher/admin permissions & PIN locking"):
 * direct URLs, browser back, refresh and raw API calls never show sensitive content while locked;
 * unlocking shows the teacher menu first with the display banner; returning to the classroom relocks.
 */
import { expect, test } from '@playwright/test';
import { api, bodyText, ensurePin, login, PIN } from './helpers.ts';

const SENSITIVE_WORDS = ['Language and text size', 'Accounts', 'Audit log', 'Student number', 'Teacher menu', 'Profile and PIN', 'Deniz Akın'];

async function expectLockedAndClean(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('lock-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Teacher area locked' })).toBeVisible();
  const text = await bodyText(page);
  for (const w of SENSITIVE_WORDS) expect(text, `"${w}" must not be on the locked screen`).not.toContain(w);
  await expect(page.getByTestId('profile-page')).toHaveCount(0);
  await expect(page.getByTestId('teacher-menu')).toHaveCount(0);
  await expect(page.getByTestId('admin-home')).toHaveCount(0);
}

test('PIN lock: no bypass via URL, back, refresh or API; menu first after unlock; classroom relocks @mobile', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);

  // Entering the classroom engages classroom mode on this device.
  await page.goto('/classroom');
  await expect(page.getByTestId('classroom-shell')).toBeVisible();
  await expect(page.getByTestId('class-banner-class')).toBeVisible();

  // Direct URLs show only the neutral lock screen (PIN-2, PIN-3, PIN-8).
  await page.goto('/admin');
  await expectLockedAndClean(page);
  await page.goto('/teacher/profile');
  await expectLockedAndClean(page);

  // Raw API requests are refused server-side with 423.
  const raw = await page.evaluate(async () => {
    const a = await fetch('/api/teacher/classes/x/students');
    const b = await fetch('/api/admin/users');
    const c = await fetch('/api/teacher/contexts');
    return [a.status, b.status, c.status];
  });
  expect(raw).toEqual([423, 423, 200]); // classroom-safe endpoints keep working

  // Wrong PIN → message, still locked.
  await page.getByLabel('Enter your PIN').fill('000000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong PIN');
  await expectLockedAndClean(page);

  // Unlock (using the on-screen keys) → teacher menu first, even though /teacher/profile was requested (PIN-4).
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByTestId('display-banner')).toContainText('Visible on the classroom display'); // PIN-5

  await page.getByRole('link', { name: 'Profile and PIN' }).first().click();
  await expect(page.getByTestId('profile-page')).toBeVisible();
  await expect(page.getByTestId('display-banner')).toBeVisible();

  // Back to the classroom relocks (PIN-6)…
  await page.getByTestId('display-banner').getByRole('button', { name: 'Back to the classroom' }).click();
  await expect(page.getByTestId('classroom-shell')).toBeVisible();
  // …so browser back shows the lock screen, not the profile.
  await page.goBack();
  await expectLockedAndClean(page);
  // Refresh keeps the lock.
  await page.reload();
  await expectLockedAndClean(page);
  expect((await api(page, 'GET', '/api/admin/users')).status).toBe(423);
  expect((await api(page, 'GET', '/api/auth/me')).body.pinUnlocked).toBe(false);
});

test('Lock button and a 423 swap straight to the lock screen', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/classroom');
  await expect(page.getByTestId('classroom-shell')).toBeVisible();
  await page.goto('/teacher');
  await page.getByLabel('Enter your PIN').fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('teacher-menu')).toBeVisible();

  await page.getByTestId('display-banner').getByRole('button', { name: 'Lock' }).click();
  await expectLockedAndClean(page);

  // Unlock again, open class settings, then lock from "another tab" (server side): the next
  // sensitive request answers 423 and the page swaps to the lock screen.
  await page.getByLabel('Enter your PIN').fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  await page.getByRole('link', { name: 'Class settings' }).first().click();
  const toggle = page.getByText('Homework', { exact: true });
  await expect(toggle).toBeVisible();
  await api(page, 'POST', '/api/auth/lock', {});
  await toggle.click();
  await expectLockedAndClean(page);
});
