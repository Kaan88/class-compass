/**
 * English reminder counter on the classroom display (S6: CNT-1..5, CNT-8, CRD-2, UX-9/10/11):
 * tap + on three students, see the class bar and the weekly counts, undo restores, a double tap
 * within 700 ms shows "Already counted", and taps made offline are synced exactly once.
 * Fictional demo data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { api, ensurePin, login, PIN } from './helpers.ts';

/** The per-student reminder boxes on the cards are on by default since S14a (D-143); this test sets them explicitly. */
async function setReminderBoxes(page: Page, contextId: string, on: boolean) {
  const mods = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/modules`)).body.modules as Array<{ module: string; enabled: boolean; config: Record<string, unknown> | null }>;
  const m = mods.find((x) => x.module === 'counters')!;
  const r = await api(page, 'PUT', `/api/teacher/contexts/${contextId}/modules/counters`, { enabled: m.enabled, config: { ...(m.config ?? {}), showReminderBoxes: on } });
  expect(r.status).toBe(200);
}

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

interface CounterState {
  id: string;
  lessonTotal: number;
  barValue: number;
  students: Array<{ studentId: string; count: number }>;
}

test('tap + on students, bar and weekly counts, undo, double tap guard, offline taps sync once, settings and history', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  const contextId = mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
  await setReminderBoxes(page, contextId, true);
  const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId, payload: { contextId } }] });
  expect(started.body.results[0].ok).toBe(true);
  const counter = async (): Promise<CounterState> => {
    const r = await api(page, 'GET', `/api/classroom/contexts/${contextId}/lesson`);
    return (r.body.counters.counters as Array<CounterState & { kind: string }>).find((c) => c.kind === 'english_reminders')!;
  };

  try {
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    await expect(page.getByTestId('lesson-dashboard')).toBeVisible();

    // The main class bar (CNT-1/2): label, supporting text, number always visible.
    const bar = page.getByTestId('counter-bar');
    await expect(bar.getByRole('heading', { name: 'Our English Time' })).toBeVisible();
    await expect(bar.getByTestId('counter-supporting')).toHaveText('0 / 10 Turkish reminders');
    await expect(bar.getByRole('meter', { name: 'Our English Time' })).toHaveAttribute('aria-valuetext', '0 / 10');

    // Tap + on three students (CNT-3). Weekly counts are compared with the counts before this run,
    // so the test also passes when it runs again in the same week (--repeat-each).
    const addButtons = page.getByRole('button', { name: /^Add one \(Turkish reminders\) for / });
    await expect(addButtons).toHaveCount(19);
    const before = await counter();
    const weeklyCount = (name: string) => (n: number) => page.getByRole('article', { name }).getByRole('img', { name: `Turkish reminders: ${n} this week` });
    const names: string[] = [];
    const weekly: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const label = (await addButtons.nth(i).getAttribute('aria-label'))!;
      const name = label.replace('Add one (Turkish reminders) for ', '');
      names.push(name);
      weekly.push(Number(await page.getByRole('article', { name }).getByTestId('student-count').innerText()));
      await addButtons.nth(i).click();
    }
    await expect(bar.getByTestId('counter-supporting')).toHaveText('3 / 10 Turkish reminders');
    for (const [i, n] of names.entries()) await expect(weeklyCount(n)(weekly[i]! + 1)).toBeVisible();
    // The undo toast names the class and the student (UX-9).
    await expect(page.getByTestId('toast').filter({ hasText: `3-A · English: +1 Turkish reminders – ${names[2]}` })).toBeVisible();
    await expect.poll(async () => (await counter()).lessonTotal, { timeout: 15_000 }).toBe(3);
    // Accessibility of the dashboard with the counter bar and counted cards (incl. colour contrast).
    const axe = await new AxeBuilder({ page }).include('[data-testid="counter-bar"]').include('#cc-student-grid').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    const first = await counter();
    const was = new Map(before.students.map((s) => [s.studentId, s.count]));
    expect(first.students.filter((s) => s.count !== (was.get(s.studentId) ?? 0)).map((s) => s.count - (was.get(s.studentId) ?? 0))).toEqual([1, 1, 1]);

    // Undo the last tap: bar and card go back, the server voids the event (CNT-4).
    await page.getByTestId('toast').filter({ hasText: names[2]! }).getByRole('button', { name: 'Undo' }).click();
    await expect(bar.getByTestId('counter-supporting')).toHaveText('2 / 10 Turkish reminders');
    await expect(weeklyCount(names[2]!)(weekly[2]!)).toBeVisible();
    await expect.poll(async () => (await counter()).lessonTotal, { timeout: 15_000 }).toBe(2);

    // Double tap within 700 ms: one count and a calm message (CNT-5).
    const card0 = page.getByRole('article', { name: names[0]! });
    await page.waitForTimeout(800);
    await card0.getByRole('button', { name: /^Add one / }).dblclick();
    await expect(card0.getByText('Already counted – tap again to add another')).toBeVisible();
    await expect(weeklyCount(names[0]!)(weekly[0]! + 2)).toBeVisible();
    await expect.poll(async () => (await counter()).lessonTotal, { timeout: 15_000 }).toBe(3);

    // Offline taps are queued on the device and synced exactly once (UX-10/11).
    await page.context().setOffline(true);
    await addButtons.nth(5).click();
    await addButtons.nth(6).click();
    await expect(bar.getByTestId('counter-supporting')).toHaveText('5 / 10 Turkish reminders');
    await expect(page.getByText('Offline – 2 changes waiting')).toBeVisible();
    expect((await counter()).lessonTotal).toBe(3);
    await page.context().setOffline(false);
    await expect.poll(async () => (await counter()).lessonTotal, { timeout: 20_000 }).toBe(5);
    await expect(page.getByText('Offline – 2 changes waiting')).toHaveCount(0);
    await page.waitForTimeout(2_000);
    expect((await counter()).lessonTotal).toBe(5);

    // After a refresh the server state is shown (and the bar did not reset: LES-2).
    await page.reload();
    await expect(page.getByTestId('counter-bar').getByTestId('counter-supporting')).toHaveText('5 / 10 Turkish reminders');

    // Filling the bar shows the chosen response once, calmly, without naming anybody (CNT-9).
    for (let i = 7; i < 12; i += 1) await addButtons.nth(i).click();
    const overlay = page.getByRole('dialog').filter({ has: page.getByTestId('threshold-overlay') });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('heading', { name: 'Back to English' })).toBeVisible();
    await expect(overlay).toContainText('We reached 10 reminders.');
    const overlayText = await overlay.innerText();
    const everyone = await addButtons.evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').replace('Add one (Turkish reminders) for ', '')));
    for (const n of everyone) expect(overlayText).not.toContain(n);
    // The undo toast of the tap that filled the bar does not name that student either (CNT-9, D-059).
    await expect(page.getByTestId('toast').filter({ hasText: '3-A · English: +1 Turkish reminders' })).toBeVisible();
    const toastTexts = await page.getByTestId('toast').allInnerTexts();
    for (const n of everyone) for (const text of toastTexts) expect(text).not.toContain(n);
    await overlay.getByRole('button', { name: 'Back to the lesson' }).click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId('threshold-banner')).toContainText('Back to English');
    // Individual counts continue after the bar is full (CNT-10); the overlay does not play again.
    await addButtons.nth(0).click();
    await expect(bar.getByTestId('counter-supporting')).toHaveText('11 / 10 Turkish reminders');
    await expect.poll(async () => (await counter()).lessonTotal, { timeout: 15_000 }).toBe(11);
    await page.reload();
    await expect(page.getByTestId('threshold-banner')).toBeVisible();
    await expect(page.getByTestId('threshold-overlay')).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
    await endActiveLessons(page);
  }

  // Teacher area (same sign-in; the login rate limit is shared by the whole suite): settings and
  // the weekly history with explicit week ranges (CNT-7).
  expect((await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN })).status).toBe(200);
  expect((await api(page, 'POST', '/api/classroom/leave')).status).toBe(200);
  await setReminderBoxes(page, contextId, false);
  await page.goto('/teacher/counters');
  await expect(page.getByTestId('counters-page')).toBeVisible();
  await expect(page.getByTestId('counter-settings').first()).toContainText('Our English Time');
  await page.getByRole('button', { name: 'Weekly history' }).first().click();
  const history = page.getByTestId('counter-history');
  await expect(history).toBeVisible();
  // Short week headers; the class timezone is stated once, in the caption (usability audit 2026-11).
  await expect(history.getByRole('columnheader').nth(1)).toHaveText(/^Mon \d{1,2} \w{3,4} – Sun \d{1,2} \w{3,4}$/);
  await expect(history.locator('caption')).toContainText('Europe/Istanbul');
});
