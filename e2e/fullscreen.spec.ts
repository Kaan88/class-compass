/**
 * S18 (D-167): full screen during lessons, with a stubbed Fullscreen API (headless Chromium has no
 * real full screen). Begin lesson enters full screen and Save and end lesson leaves it (LES-1, LES-3);
 * the top bar offers Full screen while the lesson runs and Leave full screen whenever the page is in
 * full screen; with the teacher's "Full screen during lessons" off (profile page, UX-4) neither touches
 * full screen, the button still works. The stub refuses requests made outside a user gesture, as
 * Chrome does, and counts them in `withoutGesture` (the exact log comparisons fail if one happens). The preference is put back on in `finally`; a lesson this test starts is ended. Fictional
 * demo data only.
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

type Ctx = { id: string; className: string; subjectName: { en: string } };
type FsLog = { requests: number; exits: number; withoutGesture?: number };

/** Installs a Fullscreen API that only records calls and fires `fullscreenchange`, like a browser. */
function stubFullscreen() {
  let element: Element | null = null;
  const log: { requests: number; exits: number; withoutGesture?: number } = { requests: 0, exits: 0 };
  (window as unknown as { __fs: typeof log }).__fs = log;
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get: () => element });
  Object.defineProperty(Document.prototype, 'exitFullscreen', {
    configurable: true,
    value: function exitFullscreen(this: Document) {
      log.exits += 1;
      element = null;
      this.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    },
  });
  Object.defineProperty(Element.prototype, 'requestFullscreen', {
    configurable: true,
    value: function requestFullscreen() {
      // Like Chrome: refuse a request made outside a user gesture (e.g. after an awaited command).
      if (!navigator.userActivation.isActive) {
        log.withoutGesture = (log.withoutGesture ?? 0) + 1;
        return Promise.reject(new TypeError('Permissions check failed'));
      }
      log.requests += 1;
      element = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    },
  });
}
const fsLog = (page: Page) => page.evaluate(() => (window as unknown as { __fs: FsLog }).__fs);

async function teacher(browser: Browser): Promise<{ context: BrowserContext; page: Page; ctx: Ctx }> {
  const context = await browser.newContext({ viewport: { width: 1536, height: 703 }, deviceScaleFactor: 1.25, hasTouch: true });
  await context.addInitScript(stubFullscreen);
  const page = await context.newPage();
  await login(page, 'english');
  await ensurePin(page);
  const ctx = ((await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  await endLesson(page, ctx.id);
  return { context, page, ctx };
}

async function endLesson(page: Page, contextId: string) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    if (l.contextId !== contextId) continue;
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

/** Classroom → 3-A English → Start lesson → Next through the steps → Begin lesson. */
async function startLesson(page: Page) {
  await page.goto('/classroom');
  await page.getByRole('button', { name: /3-A · English/u }).first().click();
  await expect(page.getByTestId('no-lesson')).toBeVisible();
  // No full screen button before a lesson runs.
  await expect(page.getByTestId('fullscreen-enter')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start lesson' }).click();
  const start = page.getByTestId('start-lesson');
  const begin = start.getByRole('button', { name: 'Begin lesson' });
  for (let i = 0; i < 8 && !(await begin.isVisible()); i++) await start.getByRole('button', { name: 'Next', exact: true }).click();
  await begin.click();
  await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
}

async function saveAndEnd(page: Page) {
  await page.getByRole('button', { name: 'End lesson', exact: true }).click();
  await page.getByTestId('end-lesson').getByRole('button', { name: 'Save and end lesson' }).click();
  await expect(page.getByTestId('lesson-summary')).toBeVisible();
}

test('Begin lesson enters full screen, the top bar toggles it, Save and end leaves it (S18)', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page, ctx } = await teacher(browser);
  try {
    // The preference is off by default (owner 2026-11-12, UX-4): switched on before the classroom.
    expect((await api(page, 'GET', '/api/classroom/lesson-prefs')).body).toEqual({ fullscreen: false });
    expect((await api(page, 'PUT', '/api/teacher/lesson-prefs', { fullscreen: true })).status).toBe(200);
    await startLesson(page);
    expect(await fsLog(page)).toEqual({ requests: 1, exits: 0 });

    // In full screen: a small icon button with an accessible name.
    const leave = page.getByRole('button', { name: 'Leave full screen' });
    await expect(leave).toBeVisible();
    const box = (await leave.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await new AxeBuilder({ page }).include('.cc-classroom-bar').analyze().then((r) => expect(r.violations).toEqual([]));
    await leave.click();
    expect(await fsLog(page)).toEqual({ requests: 1, exits: 1 });
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(leave).toBeVisible();
    expect(await fsLog(page)).toEqual({ requests: 2, exits: 1 });

    await saveAndEnd(page);
    expect(await fsLog(page)).toEqual({ requests: 2, exits: 2 });
    // The lesson is over: no full screen button.
    await expect(page.getByTestId('fullscreen-enter')).toHaveCount(0);
    await expect(page.getByTestId('fullscreen-leave')).toHaveCount(0);
  } finally {
    await endLesson(page, ctx.id);
    await context.close();
    await resetPref(browser);
  }
});

/** Back to the default (off) in a fresh session: the one used is in classroom mode, PIN-locked. */
async function resetPref(browser: Browser) {
  const reset = await browser.newContext();
  const r = await reset.newPage();
  await login(r, 'english');
  expect((await api(r, 'PUT', '/api/teacher/lesson-prefs', { fullscreen: false })).status).toBe(200);
  await reset.close();
}

test('with "Full screen during lessons" off, Start and End lesson leave full screen alone (S18)', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page, ctx } = await teacher(browser);
  try {
    // Off by default on the profile page; switched on and off again there (before the classroom: no PIN
    // needed outside classroom mode).
    await page.goto('/teacher/profile');
    const section = page.getByTestId('lesson-prefs');
    const toggle = section.getByRole('switch', { name: 'Full screen during lessons' });
    await expect(toggle).not.toBeChecked();
    for (const on of [true, false]) {
      const saved = page.waitForResponse((r) => r.url().endsWith('/api/teacher/lesson-prefs') && r.request().method() === 'PUT');
      await toggle.click({ force: true });
      expect((await saved).status()).toBe(200);
      if (on) await expect(toggle).toBeChecked();
      else await expect(toggle).not.toBeChecked();
    }
    expect((await api(page, 'GET', '/api/classroom/lesson-prefs')).body).toEqual({ fullscreen: false });

    await startLesson(page);
    expect(await fsLog(page)).toEqual({ requests: 0, exits: 0 });
    // The button still works.
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    expect(await fsLog(page)).toEqual({ requests: 1, exits: 0 });
    await saveAndEnd(page);
    expect(await fsLog(page)).toEqual({ requests: 1, exits: 0 });
    // Still in full screen on the summary: Leave full screen stays offered (a touch panel has no Esc).
    await expect(page.getByTestId('fullscreen-enter')).toHaveCount(0);
    await page.getByRole('button', { name: 'Leave full screen' }).click();
    expect(await fsLog(page)).toEqual({ requests: 1, exits: 1 });
    await expect(page.getByTestId('fullscreen-leave')).toHaveCount(0);
  } finally {
    await endLesson(page, ctx.id);
    await context.close();
    await resetPref(browser);
  }
});
