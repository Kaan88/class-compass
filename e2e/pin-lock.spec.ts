/**
 * Presentation-safe teacher area (PIN-1..9, ENG-3 "teacher/admin permissions & PIN locking"):
 * direct URLs, browser back, refresh and raw API calls never show sensitive content while locked;
 * unlocking shows the teacher menu first with the display banner; returning to the classroom relocks.
 */
import { chromium, expect, test } from '@playwright/test';
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
  // Class settings is in the Class setup hub (S14e3, D-156).
  await page.getByTestId('menu-setup').getByRole('link', { name: 'Class setup' }).click();
  await page.getByTestId('setup-hub').getByRole('link', { name: 'Class settings' }).click();
  // The module switch (the teacher menu also has a Homework link since S8).
  const toggle = page.locator('.cc-switch', { has: page.getByRole('switch', { name: 'Homework', exact: true }) });
  await expect(toggle).toBeVisible();

  // Toasts from the teacher area do not survive the lock (PIN-3). Toggle twice to leave the demo data as it was.
  await toggle.click();
  await expect(page.getByTestId('toast').first()).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId('toast').first()).toBeVisible();
  await page.getByTestId('display-banner').getByRole('button', { name: 'Lock' }).click();
  await expectLockedAndClean(page);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.getByLabel('Enter your PIN').fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  // Class settings is in the Class setup hub (S14e3, D-156).
  await page.getByTestId('menu-setup').getByRole('link', { name: 'Class setup' }).click();
  await page.getByTestId('setup-hub').getByRole('link', { name: 'Class settings' }).click();
  await expect(toggle).toBeVisible();

  await api(page, 'POST', '/api/auth/lock', {});
  await toggle.click();
  await expectLockedAndClean(page);
});

/** In classroom mode on this device: unlock from the teacher area and open the profile (sensitive). */
async function unlockToProfile(page: import('@playwright/test').Page) {
  await page.goto('/teacher');
  await page.getByLabel('Enter your PIN').fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  await page.getByRole('link', { name: 'Profile and PIN' }).first().click();
  await expect(page.getByTestId('profile-page')).toBeVisible();
}

test('PIN-8 back/forward cache (S20a): a page really restored after the lock shows the lock screen, never the teacher data', async ({ baseURL }) => {
  // Playwright starts Chromium with `--disable-back-forward-cache`, and its headless shell turns the
  // cache off on its own ("BackForwardCacheDisabledForDelegate"). This test starts its own browser:
  // the full Chromium build (new headless) without that switch, so going back really restores the
  // frozen page (asserted below) instead of loading it again.
  const browser = await chromium.launch({ channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, locale: 'en-GB', timezoneId: 'Europe/Istanbul' });
    const page = await context.newPage();
    await login(page, 'english');
    await ensurePin(page);
    await page.goto('/classroom');
    await expect(page.getByTestId('classroom-shell')).toBeVisible();
    await unlockToProfile(page);

    // Leave the app for another document, lock meanwhile (another tab, the server window), come back.
    await page.evaluate(() => ((window as unknown as { __s20aMark: boolean }).__s20aMark = true));
    // Chromium says why it did not keep a page; the reasons go into the failure message.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    const reasons: string[] = [];
    cdp.on('Page.backForwardCacheNotUsed', (e) => reasons.push(...e.notRestoredExplanations.map((x) => x.reason)));
    await page.goto('/healthz');
    expect((await api(page, 'POST', '/api/auth/lock', {})).status).toBe(200);
    // A page restored from the cache fires no new load event: wait only for the navigation to commit.
    await page.goBack({ waitUntil: 'commit' });
    const restored = await page.evaluate(() => (window as unknown as { __s20aMark?: boolean }).__s20aMark === true);
    expect(restored, `the page came back from the back/forward cache (not kept: ${reasons.join(', ') || 'no reason given'})`).toBe(true);
    await expectLockedAndClean(page);
    expect((await api(page, 'GET', '/api/auth/me')).body.pinUnlocked).toBe(false);
  } finally {
    await browser.close();
  }
});

test('PIN-8 restore handler (S20a): a pageshow with persisted re-runs the guards, whatever the browser cached', async ({ page }) => {
  // The handler itself (main.tsx `pageshow` with `persisted`), on the page still showing the profile
  // while the server has locked: a restore must not trust what is on screen.
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/classroom');
  await expect(page.getByTestId('classroom-shell')).toBeVisible();
  await unlockToProfile(page);
  expect((await api(page, 'POST', '/api/auth/lock', {})).status).toBe(200);
  await expect(page.getByTestId('profile-page')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expectLockedAndClean(page);
  expect((await api(page, 'GET', '/api/auth/me')).body.pinUnlocked).toBe(false);
});

test('PIN-7 inactivity relock (S20a): the teacher area locks itself after 3 minutes without input, input restarts the wait', async ({ page }) => {
  // The browser clock is controlled, so the client's 3-minute timer (CLIENT_IDLE_LOCK_MS) runs in
  // moments; no test-only server setting is needed. The server's own 5-minute window is not reached.
  await page.clock.install();
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/classroom');
  await expect(page.getByTestId('classroom-shell')).toBeVisible();
  await unlockToProfile(page);

  // Two minutes without input: still open.
  await page.clock.fastForward(2 * 60_000);
  await expect(page.getByTestId('profile-page')).toBeVisible();
  // Input restarts the wait: two more minutes (four since the unlock) and still open.
  await page.mouse.move(10, 10);
  await page.keyboard.press('Shift');
  await page.clock.fastForward(2 * 60_000);
  await expect(page.getByTestId('profile-page')).toBeVisible();
  expect((await api(page, 'GET', '/api/auth/me')).body.pinUnlocked).toBe(true);

  // Three minutes without input: the screen locks and the server session is locked too.
  await page.clock.fastForward(60_000 + 5_000);
  await expectLockedAndClean(page);
  await expect.poll(async () => (await api(page, 'GET', '/api/auth/me')).body.pinUnlocked).toBe(false);
  expect((await api(page, 'GET', '/api/admin/users')).status).toBe(423);
});

test('PIN-4 in every tab: a second tab waiting on a deep link shows the teacher menu first after unlock', async ({ page, context }) => {
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/classroom');
  await expect(page.getByTestId('classroom-shell')).toBeVisible();

  // Tab 2 sits on the lock screen of a deep link. Its clock is controllable so its cached `me` can go stale.
  const other = await context.newPage();
  await other.clock.install();
  await other.goto('/teacher/profile');
  await expectLockedAndClean(other);

  // The PIN is typed in the first tab.
  await page.goto('/teacher');
  await page.getByLabel('Enter your PIN').fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByTestId('teacher-menu')).toBeVisible();

  // Tab 2 refetches `me` when it regains focus and sees the unlocked session: menu first, never the profile.
  await other.clock.fastForward(60_000);
  await other.bringToFront();
  await other.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(other.getByTestId('teacher-menu')).toBeVisible();
  await expect(other).toHaveURL(/\/teacher$/);
  await expect(other.getByTestId('profile-page')).toHaveCount(0);
  await other.close();

  // Leave the device relocked for the next test.
  await page.getByTestId('display-banner').getByRole('button', { name: 'Lock' }).click();
  await expectLockedAndClean(page);
});
