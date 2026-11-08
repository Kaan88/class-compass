/**
 * Achievements and avatars end to end (S13c items 4, 6, 9–11; D-121, D-124). Fictional demo data only.
 * - A badge given in class through the outbox shows the "Celebrate" moment on the display, then the
 *   student's phone shows the badge with a one-time celebration.
 * - A student picks an avatar on the phone; it appears on their classroom card. axe on the creator at 375×812.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
}

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }] });
  }
}

const phoneOf = (browser: import('@playwright/test').Browser) => browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });

test('a badge given in class shows the moment on the display and a celebration on the student phone', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[8]!;
  // Read before the display opens (the teacher area is locked in classroom mode).
  const link = await studentLinkUrl(page, ctx.classId, student.id);
  const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true } }] });
  expect(started.body.results[0].ok).toBe(true);
  try {
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    const panel = page.getByTestId('achievements-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('achievements-give').click();
    const dialog = page.getByTestId('achievements-dialog');
    const pick = dialog.locator('label', { hasText: student.fullName });
    await pick.getByTestId('achievements-student').check();
    // A chosen student is marked as chosen, never struck through (usability pass, D-139).
    expect(await pick.locator('span').last().evaluate((e) => getComputedStyle(e).textDecorationLine)).not.toContain('line-through');
    const badge = dialog.getByTestId('achievements-badge').first();
    const badgeName = (await badge.locator('strong').innerText()).trim();
    await badge.click();
    await dialog.getByTestId('achievements-confirm').click();
    const moment = page.getByTestId('achievements-moment');
    await expect(moment).toBeVisible();
    await expect(moment.getByTestId('achievements-moment-names')).toContainText(student.fullName);
    await moment.getByTestId('achievements-moment-close').click();
    // Undo is offered at once in a note that is always on screen (D-139) ...
    const note = page.getByTestId('toast').filter({ hasText: badgeName });
    await expect(note.getByRole('button', { name: 'Undo' })).toBeInViewport();
    // ... and stays offered for 10 minutes on the panel.
    await expect(panel.getByTestId('achievements-undo')).toBeVisible();

    const phone = await phoneOf(browser);
    const p = await phone.newPage();
    try {
      const seen = p.waitForResponse((r) => r.url().endsWith('/api/student/achievements/seen'));
      await p.goto(link);
      const english = p.getByRole('region', { name: 'English', exact: true });
      const earned = english.getByTestId('student-badge').filter({ hasText: badgeName });
      await expect(earned).toBeVisible();
      await expect(p.getByTestId('celebration')).toBeVisible();
      // Seen once: no celebration on the next visit.
      expect((await seen).status()).toBe(200);
      await p.reload();
      await expect(english.getByTestId('student-badge').filter({ hasText: badgeName })).toBeVisible();
      await expect(english.getByTestId('student-badge').filter({ hasText: badgeName })).not.toHaveAttribute('data-new', /.*/);
    } finally {
      await phone.close();
    }
  } finally {
    await endActiveLessons(page);
  }
});

test('a student chooses an avatar on the phone and it appears on their classroom card; the creator passes axe @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[test.info().project.name === 'mobile' ? 10 : 9]!;
  const phone = await phoneOf(browser);
  const p = await phone.newPage();
  try {
    await p.goto(await studentLinkUrl(page, ctx.classId, student.id));
    const panel = p.getByTestId('student-avatar');
    await panel.getByTestId('avatar-change').click();
    const creator = p.getByTestId('avatar-creator');
    await expect(creator).toBeVisible();
    await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    const ready = await new AxeBuilder({ page: p }).include('[data-testid="avatar-creator"]').analyze();
    expect(ready.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await creator.getByTestId('avatar-tab-make').click();
    await creator.getByTestId('avatar-type-person').click();
    await creator.getByTestId('avatar-randomise').click();
    const make = await new AxeBuilder({ page: p }).include('[data-testid="avatar-creator"]').analyze();
    expect(make.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    // No horizontal scroll on a 375 px phone.
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const saved = p.waitForResponse((r) => r.url().endsWith('/api/student/avatar') && r.request().method() === 'PUT');
    await creator.getByTestId('avatar-save').click();
    expect((await saved).status()).toBe(200);
  } finally {
    await phone.close();
  }

  const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true } }] });
  expect(started.body.results[0].ok).toBe(true);
  try {
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    const card = page.locator('article.cc-student-card', { hasText: student.fullName }).first();
    await expect(card.locator('.cc-avatar--art[data-avatar="person"]')).toBeVisible();
  } finally {
    await endActiveLessons(page);
  }
});
