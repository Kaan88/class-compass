/**
 * Sign-in, per-teacher language (UX-3, UX-4) and per-class theme (THM-2, THM-3) — ENG-3
 * "language & theme switching".
 */
import { expect, test } from '@playwright/test';
import { api, ensurePin, login, PASSWORD } from './helpers.ts';

test('sign-in rejects a wrong password and lets the administrator in @mobile', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect sign-in details');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('admin-home')).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
});

test('changing language affects only that teacher', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  try {
    await login(pa, 'english');
    await pa.goto('/teacher/profile');
    await pa.getByLabel('Language').selectOption('tr');
    await expect(pa.getByRole('heading', { name: 'Profil', exact: true })).toBeVisible();
    await expect(pa.locator('html')).toHaveAttribute('lang', 'tr');

    await login(pb, 'classroom3a');
    await pb.goto('/teacher');
    await expect(pb.getByRole('heading', { name: 'Teacher menu' })).toBeVisible();
    await expect(pb.locator('html')).toHaveAttribute('lang', 'en');

    // The first teacher keeps Turkish after a reload (stored per account, not per device).
    await pa.reload();
    await expect(pa.getByRole('heading', { name: 'Profil', exact: true })).toBeVisible();
    await pa.getByLabel('Dil').selectOption('en');
    await expect(pa.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});

test('theme is chosen per class and applied in the classroom', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const teacherCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const teacher = await teacherCtx.newPage();
  try {
    await login(admin, 'admin');
    await admin.goto('/admin/classes');
    const row = admin.getByRole('row', { name: /3-B/ });
    await row.getByRole('button', { name: 'Edit' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByTestId('theme-option-classroom').click();
    await expect(dialog.getByTestId('theme-option-classroom')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByTestId('theme-preview-classroom').first()).toBeVisible(); // live preview
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('Colourful classroom');

    await login(teacher, 'english');
    await ensurePin(teacher);
    await teacher.goto('/classroom');
    await teacher.getByRole('button', { name: /3-A · English/ }).click();
    await expect(teacher.locator('html')).toHaveAttribute('data-theme', 'explorer');
    await expect(teacher.getByTestId('class-banner-class')).toHaveText('3-A');
    await teacher.getByRole('button', { name: /3-B · English/ }).click();
    await expect(teacher.locator('html')).toHaveAttribute('data-theme', 'classroom');
    await expect(teacher.getByTestId('class-banner-class')).toHaveText('3-B');
  } finally {
    // Restore the demo theme so the run is repeatable.
    const classes = await api(admin, 'GET', '/api/admin/classes');
    const c3b = classes.body.classes.find((c: { name: string }) => c.name === '3-B');
    if (c3b) await api(admin, 'PATCH', `/api/admin/classes/${c3b.id}`, { theme: 'animals' });
    await adminCtx.close();
    await teacherCtx.close();
  }
});
