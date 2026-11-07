/**
 * Administration UI (ACC-2, ACC-3, DAT-3, DAT-5, D-014): a new teacher gets a one-time temporary
 * password and must change it; deactivation needs type-to-confirm; media modules are clearly
 * labelled as disabled until consent is confirmed.
 */
import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

test('create a teacher, show the temporary password once, forced password change, deactivate', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const newCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const fresh = await newCtx.newPage();
  const loginName = `e2e.teacher.${Date.now().toString(36)}`;
  try {
    await login(admin, 'admin');
    await admin.goto('/admin/users');
    await admin.getByRole('button', { name: 'New account' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel('Username').fill(loginName);
    await dialog.getByLabel('Name', { exact: true }).fill('Ece Örnek (E2E)');
    // The interface language must be chosen (S13a, D-099).
    await dialog.getByRole('button', { name: 'New account' }).click();
    await expect(dialog.getByText('Choose the interface language.')).toBeVisible();
    await dialog.getByLabel('Interface language').selectOption({ label: 'English' });
    await dialog.getByRole('button', { name: 'New account' }).click();
    const temp = await admin.getByTestId('temp-password').innerText();
    expect(temp.length).toBeGreaterThanOrEqual(10);
    await expect(admin.getByRole('button', { name: 'Copy' })).toBeVisible();
    await admin.getByRole('button', { name: 'I have stored it' }).click();
    await expect(admin.getByTestId('temp-password')).toHaveCount(0); // shown only once
    const row = admin.getByRole('row', { name: new RegExp(loginName.replace(/\./g, '\\.')) });
    await expect(row).toContainText('Must change password');

    // The new teacher must change the temporary password first.
    await login(fresh, loginName, temp);
    await expect(fresh).toHaveURL(/\/change-password/);
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'en');
    await fresh.getByLabel('Current password').fill(temp);
    await fresh.getByLabel('New password', { exact: true }).fill('a-new-e2e-password-123');
    await fresh.getByLabel('Repeat new password').fill('a-new-e2e-password-123');
    await fresh.getByRole('button', { name: 'Save password' }).click();
    await expect(fresh.getByTestId('teacher-menu')).toBeVisible();

    // Deactivation requires typing the username (DAT-5).
    await admin.reload();
    await row.getByRole('button', { name: 'Deactivate' }).click();
    const confirm = admin.getByRole('alertdialog');
    const action = confirm.getByRole('button', { name: 'Deactivate' });
    await expect(action).toBeDisabled();
    await confirm.getByLabel(/To confirm, type/).fill(loginName);
    await expect(action).toBeEnabled();
    await action.click();
    await expect(row).toContainText('Deactivated');
  } finally {
    await adminCtx.close();
    await newCtx.close();
  }
});

test('media modules are labelled as disabled until consent is confirmed', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/admin/modules');
  await expect(page.getByText('Disabled until consent is confirmed').first()).toBeVisible();
  await expect(page.getByRole('switch', { name: /Student photos/ })).not.toBeChecked();
});
