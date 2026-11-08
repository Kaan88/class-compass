/**
 * S13b (D-108): an administrator creates a teacher with an invite link, which is emailed (fake file
 * transport, no SMTP); the teacher chooses email sign-in links, is signed in, and later signs in again
 * with the emailed link (pressing "Sign in" on the landing page) and with the 6-digit code on the device
 * that asked. Fictional data only.
 */
import { expect, test } from '@playwright/test';
import { codeIn, linkIn, waitForMail } from './mail.ts';
import { login } from './helpers.ts';

test('invite link → email sign-in links → sign in with the link and with the code', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const teacherCtx = await browser.newContext();
  const otherCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const teacher = await teacherCtx.newPage();
  const other = await otherCtx.newPage();
  const stamp = Date.now().toString(36);
  const loginName = `e2e.invite.${stamp}`;
  const email = `invite.${stamp}@school.example`;
  try {
    await login(admin, 'admin');
    await admin.goto('/admin/users');
    await admin.getByRole('button', { name: 'New account' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel('Username').fill(loginName);
    await dialog.getByLabel('Name', { exact: true }).fill('Defne Davet (E2E)');
    await dialog.getByLabel('Email (optional)').fill(email);
    await expect(dialog.getByLabel('First sign-in')).toHaveValue('invite');
    await dialog.getByRole('button', { name: 'New account' }).click();
    const shown = await admin.getByTestId('invite-link').innerText();
    await expect(admin.getByText('The invite was emailed', { exact: false })).toBeVisible();
    await expect(admin.getByRole('img', { name: /QR code of the invite link/ })).toBeVisible();
    await admin.getByRole('button', { name: 'Done' }).click();
    const row = admin.getByRole('row', { name: new RegExp(loginName.replace(/\./g, '\\.')) });
    await expect(row).toContainText('Invite pending');

    // The email carries the same single-use link.
    const invite = await waitForMail(email, 1);
    expect(linkIn(invite.text)).toBe(shown.trim());

    await teacher.goto(linkIn(invite.text));
    await expect(teacher.getByRole('heading', { name: 'Welcome to Class Compass' })).toBeVisible();
    await expect(teacher).not.toHaveURL(/token=/); // removed from the address bar at once
    await expect(teacher.getByTestId('invite-username')).toBeVisible(); // on its own, not mid-sentence (D-142)
    await teacher.getByRole('radio', { name: /With email sign-in links/ }).check();
    await teacher.getByRole('button', { name: 'Continue' }).click();
    await expect(teacher.getByTestId('teacher-menu')).toBeVisible();

    // The invite works once.
    await other.goto(linkIn(invite.text));
    await expect(other.getByText('This invite link does not work', { exact: false })).toBeVisible();
    await expect(other.getByRole('link', { name: 'Back to sign-in' })).toBeVisible(); // not a dead end (D-142)

    // Sign out, then sign in with an emailed link: opening the page does nothing until "Sign in".
    await teacher.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(teacher).toHaveURL(/\/login/);
    await teacher.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await teacher.getByLabel('Email').fill(email);
    await teacher.getByRole('button', { name: 'Send the link' }).click();
    await expect(teacher.getByText('belongs to an account that signs in with email links', { exact: false })).toContainText(email);
    await expect(teacher.getByRole('button', { name: 'Use a different email' })).toBeVisible();
    const signIn = await waitForMail(email, 2);
    await teacher.goto(linkIn(signIn.text));
    await expect(teacher.getByRole('heading', { name: 'Sign in to Class Compass' })).toBeVisible();
    await teacher.getByRole('button', { name: 'Sign in' }).click();
    await expect(teacher.getByTestId('teacher-menu')).toBeVisible();

    // The 6-digit code works on the device that asked.
    await other.goto('/login');
    await other.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await other.getByLabel('Email').fill(email);
    await other.getByRole('button', { name: 'Send the link' }).click();
    const third = await waitForMail(email, 3);
    await other.getByLabel('6-digit code').fill(codeIn(third.text));
    await other.getByRole('button', { name: 'Sign in' }).click();
    await expect(other.getByTestId('teacher-menu')).toBeVisible();

    // The profile shows the method; no password form for an email-link account.
    await other.goto('/teacher/profile');
    await expect(other.getByTestId('signin-method')).toContainText('You sign in with links sent to your email address');
    await expect(other.getByRole('heading', { name: 'Change password' })).toHaveCount(0);

    // The admin sees the method.
    await admin.reload();
    await expect(row).toContainText('Sign-in: email links');
  } finally {
    await adminCtx.close();
    await teacherCtx.close();
    await otherCtx.close();
  }
});

test('signed out, the sign-in card switches to Türkçe and remembers it; an expired link leads back (D-142)', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Username')).toBeVisible();
  await page.getByTestId('auth-language').getByRole('button', { name: 'Türkçe' }).click();
  await expect(page.getByLabel('Kullanıcı adı')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeVisible();
  await page.goto('/signin-link');
  await expect(page.getByText('Bu giriş bağlantısı', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Giriş sayfasına dön' }).click();
  await expect(page.getByLabel('Kullanıcı adı')).toBeVisible();
  await page.goto('/reset-password');
  await page.getByRole('link', { name: 'Yeni bir sıfırlama bağlantısı iste' }).click();
  await expect(page).toHaveURL(/mode=forgot/u);
  await page.getByTestId('auth-language').getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: /Reset your password|Sign in/u })).toBeVisible();
});
