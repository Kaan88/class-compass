import { expect, type Page } from '@playwright/test';

/** Fixed, test-only password of every demo account (see e2e/server.ts). Fictional data only. */
export const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-only-Passw0rd!';
export const PIN = '482913';

/** Same-origin JSON API call that shares the page's cookies (like the app's own fetch). */
export async function api(page: Page, method: string, path: string, body?: unknown) {
  const res = await page.request.fetch(path, {
    method,
    headers: { 'x-cc-csrf': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { data: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status(), body: text ? JSON.parse(text) : null };
}

export async function login(page: Page, user: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Make sure the teacher has our test PIN (idempotent; the PIN can always be re-set with the password). */
export async function ensurePin(page: Page) {
  const r = await api(page, 'POST', '/api/auth/pin', { currentPassword: PASSWORD, pin: PIN });
  expect(r.status).toBe(200);
}

/** Visible text of the whole document (what a pupil could read on the display). */
export const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
