/**
 * Offline cold start (S26b, D-190; D-006, LES-1, UX-10, UX-11): a teacher who opened the classroom on
 * this device before reloads it with no network. The app's service worker serves the page and its
 * files, the classroom comes back from this device's copy (PIN-locked), a lesson is started and waits
 * in the outbox with a calm "saved" note, and once the connection returns the start reaches the server
 * exactly once and the board appears. Fictional demo data only.
 */
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { api, ensurePin, login, PIN } from './helpers.ts';
import { en } from '../tests/messages.ts';

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

/** How many classroom queries this device keeps for an offline start (lib/offlineClassroom.ts). */
const keptQueries = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('cc-offline-classroom');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('queries')) return resolve([]);
          const all = db.transaction('queries').objectStore('queries').getAllKeys();
          all.onsuccess = () => resolve(all.result.map(String));
          all.onerror = () => resolve([]);
        };
      }),
  );

test('offline cold start: reload the classroom with no network, start a lesson that waits, it reaches the server once back online', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, 'admin');
  const since = Date.now();
  const starts = async () => {
    const r = await api(admin, 'GET', `/api/admin/audit?entity=lesson&action=lesson.start&from=${since}&pageSize=50`);
    return (r.body?.items ?? []).length as number;
  };
  try {
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    await expect(page.getByTestId('class-banner-class')).toHaveText('3-A');
    await expect(page.getByTestId('no-lesson')).toBeVisible();

    // The worker of this build controls the page, and the classroom data is on the device.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);
    await expect
      .poll(async () => {
        const keys = await keptQueries(page);
        return ['"contexts"', '"roster"', '"lesson"', '"routines"'].every((k) => keys.some((x) => x.includes(k)));
      }, { timeout: 20_000 })
      .toBe(true);
    // Nothing of the API is in the worker's caches (D-190).
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(5);
    expect(cached.filter((u) => u.startsWith('/api/'))).toEqual([]);

    // No network: reload. The page, its files and the classroom come back from this device.
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByTestId('classroom-shell')).toBeVisible();
    await expect(page.getByTestId('class-banner-class')).toHaveText('3-A');
    await expect(page.getByTestId('offline-note')).toContainText(en['classroom.offlineNote']);
    await expect(page.getByTestId('no-lesson')).toBeVisible();

    // Start the lesson: the steps show the saved class (19 students), Begin queues the start.
    await page.getByRole('button', { name: 'Start lesson' }).click();
    const start = page.getByTestId('start-lesson');
    await expect(start.locator('.cc-att-item')).toHaveCount(19);
    const begin = start.getByRole('button', { name: 'Begin lesson' });
    for (let i = 0; i < 8 && !(await begin.isVisible()); i += 1) await start.getByRole('button', { name: 'Next', exact: true }).click();
    await begin.click();

    const queued = page.getByTestId('queued-start');
    await expect(queued).toBeVisible();
    await expect(queued).toContainText(en['lesson.queued.offline']);
    await expect(page.getByText('Offline – 1 change waiting')).toBeVisible();
    expect(await starts()).toBe(0);

    // Back online: the queued start is sent (once) and the board appears.
    await page.context().setOffline(false);
    await expect(page.getByTestId('lesson-dashboard')).toBeVisible({ timeout: 30_000 });
    await expect.poll(starts, { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId('queued-start')).toHaveCount(0);
    await page.waitForTimeout(1_500);
    expect(await starts()).toBe(1);
  } finally {
    await page.context().setOffline(false);
    await endActiveLessons(page);
    await adminCtx.close();
  }
});

/** Open the classroom on 3-A and wait until the worker controls the page and the copy is saved. */
async function openClassroomWithCopy(page: Page) {
  await page.goto('/classroom');
  await page.getByRole('button', { name: /3-A · English/ }).click();
  await expect(page.getByTestId('class-banner-class')).toHaveText('3-A');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);
  await expect
    .poll(async () => {
      const keys = await keptQueries(page);
      return ['"contexts"', '"roster"', '"lesson"', '"routines"'].every((k) => keys.some((x) => x.includes(k)));
    }, { timeout: 20_000 })
    .toBe(true);
}

/** The commands in this device's outbox as `type:state`. */
const outboxOps = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('cc-outbox');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('ops')) return resolve([]);
          const all = db.transaction('ops').objectStore('ops').getAll();
          all.onsuccess = () => resolve((all.result as Array<{ type: string; state: string }>).map((o) => `${o.type}:${o.state}`));
          all.onerror = () => resolve([]);
        };
      }),
  );

test('opened offline after the teacher area was unlocked: back online, the teacher area asks for the PIN (PIN-6, review of S26b)', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  try {
    await openClassroomWithCopy(page);
    // The teacher unlocks the teacher area and goes there.
    expect((await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN })).status).toBe(200);
    await page.goto('/teacher');
    await expect(page.getByTestId('teacher-menu')).toBeVisible();

    // The network drops; the teacher goes back to the classroom (from the device copy).
    await page.context().setOffline(true);
    await page.goto('/classroom');
    await expect(page.getByTestId('offline-note')).toBeVisible();

    // Back online: the server session is relocked before anything trusts it.
    await page.context().setOffline(false);
    await expect.poll(async () => (await api(page, 'GET', '/api/auth/me')).body.pinUnlocked, { timeout: 20_000 }).toBe(false);
    expect((await api(page, 'GET', '/api/auth/me')).body.classroomMode).toBe(true);
    await page.getByRole('button', { name: 'Teacher area' }).click();
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await expect(page.getByTestId('teacher-menu')).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
  }
});

test('End lesson offline, then a reload: the saved end shows, never the board; back online it ends once (review of S26b)', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, 'admin');
  const since = Date.now();
  const ends = async () => {
    const r = await api(admin, 'GET', `/api/admin/audit?entity=lesson&action=lesson.end&from=${since}&pageSize=50`);
    return (r.body?.items ?? []).length as number;
  };
  try {
    await openClassroomWithCopy(page);
    // Start the lesson online; the running lesson goes into the device copy.
    await page.getByRole('button', { name: 'Start lesson' }).click();
    const start = page.getByTestId('start-lesson');
    const begin = start.getByRole('button', { name: 'Begin lesson' });
    for (let i = 0; i < 8 && !(await begin.isVisible()); i += 1) await start.getByRole('button', { name: 'Next', exact: true }).click();
    await begin.click();
    await expect(page.getByTestId('lesson-dashboard')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);

    // Offline: End lesson, Save and end. The end waits, shown as saved.
    await page.context().setOffline(true);
    await page.getByRole('button', { name: en['lesson.end'], exact: true }).click();
    await page.getByRole('button', { name: en['lesson.saveAndEnd'] }).click();
    const queued = page.getByTestId('queued-end');
    await expect(queued).toBeVisible();
    await expect(queued).toContainText(en['lesson.queuedEnd.offline']);
    await expect(page.getByTestId('lesson-dashboard')).toHaveCount(0);

    // Reload offline: still the saved end, never the board of the ended lesson.
    await page.reload();
    await expect(page.getByTestId('classroom-shell')).toBeVisible();
    await expect(page.getByTestId('queued-end')).toBeVisible();
    await expect(page.getByTestId('lesson-dashboard')).toHaveCount(0);
    expect(await outboxOps(page)).toEqual(['lesson.end:pending']);
    expect(await ends()).toBe(0);

    // Back online: the end is sent once, the summary appears, nothing is refused.
    await page.context().setOffline(false);
    await expect(page.getByTestId('lesson-summary')).toBeVisible({ timeout: 30_000 });
    await expect.poll(ends, { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(1_500);
    expect(await ends()).toBe(1);
    expect(await outboxOps(page)).toEqual([]);
    await expect(page.getByTestId('lesson-dashboard')).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
    await endActiveLessons(page);
    await adminCtx.close();
  }
});
