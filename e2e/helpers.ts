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

/**
 * Click "Sign in" on the filled form. The e2e server raises the sign-in rate limit through the
 * test-only CC_TEST_LOGIN_RATE_LIMIT (ignored outside NODE_ENV=test), so no test waits for a new
 * rate-limit window any more.
 */
export async function submitSignIn(page: Page) {
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/auth/login'));
  // The sign-in page follows the browser's language before sign-in (D-142): English or Turkish.
  await page.getByRole('button', { name: /^(Sign in|Giriş yap)$/u }).click();
  expect((await answered).status()).not.toBe(429);
}

export async function login(page: Page, user: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(/^(Username|Kullanıcı adı)$/u).fill(user);
  await page.getByLabel(/^(Password|Şifre)$/u).fill(password);
  await submitSignIn(page);
  await expect(page).not.toHaveURL(/\/login/);
}

/** Make sure the teacher has our test PIN (idempotent; the PIN can always be re-set with the password). */
export async function ensurePin(page: Page) {
  const r = await api(page, 'POST', '/api/auth/pin', { currentPassword: PASSWORD, pin: PIN });
  expect(r.status).toBe(200);
}

/** Panels that live in the classroom board's dock by default (S14b, D-148). */
export type DockPanel = 'assistant' | 'secret' | 'groups' | 'homework' | 'achievements' | 'counters' | 'routine' | 'focus';

/**
 * Open a panel from the classroom board's dock (S14b, D-148): its button opens the panel full screen.
 * Returns the view (a dialog); close it with `closeDock`.
 */
export async function openDock(page: Page, panel: DockPanel) {
  await page.getByTestId(`dock-${panel}`).click();
  const view = page.getByTestId(`dock-view-${panel}`);
  await expect(view).toBeVisible();
  // The dialog fades in: measuring (axe, positions) waits until it has finished.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  return view;
}

export async function closeDock(page: Page, panel: DockPanel) {
  const view = page.getByTestId(`dock-view-${panel}`);
  await view.getByTestId('dialog-close').click();
  await expect(view).toHaveCount(0);
}

/** Visible text of the whole document (what a pupil could read on the display). */
export const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

/** A student's permanent link (S13b2, D-115), read from the teacher's class links list. */
export async function studentLinkUrl(page: Page, classId: string, studentId: string): Promise<string> {
  const r = await api(page, 'GET', `/api/teacher/classes/${classId}/student-links`);
  expect(r.status).toBe(200);
  const row = (r.body.students as Array<{ id: string; link: { url: string | null } | null }>).find((s) => s.id === studentId);
  const url = row?.link?.url;
  expect(url, 'the student has a working link').toBeTruthy();
  return url!;
}
