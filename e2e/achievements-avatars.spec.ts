/**
 * Achievements and avatars end to end (S13c items 4, 6, 9–11; D-121, D-124). Fictional demo data only.
 * - A badge given in class through the outbox shows the "Celebrate" moment on the display, then the
 *   student's phone shows the badge with a one-time celebration.
 * - A student picks an avatar on the phone; it appears on their classroom card. axe on the creator at 375×812.
 * - S25a (D-185): a group shown in the lesson ticks its members in the award dialog in one tap.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { api, closeDock, ensurePin, login, openDock, studentLinkUrl } from './helpers.ts';

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
    // Achievements are a button in the board's dock (S14b): it opens the panel full screen.
    const view = await openDock(page, 'achievements');
    const panel = view.getByTestId('achievements-panel');
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
    // In the dock view the note is in the panel (the page under the full-screen view is inert) ...
    await expect(panel.getByTestId('achievements-note')).toContainText(badgeName);
    // ... and Undo stays offered for 10 minutes on the panel (D-139).
    await expect(panel.getByTestId('achievements-undo')).toBeInViewport();
    await closeDock(page, 'achievements');

    const phone = await phoneOf(browser);
    const p = await phone.newPage();
    try {
      const seen = p.waitForResponse((r) => r.url().endsWith('/api/student/achievements/seen'));
      await p.goto(link);
      // Celebrated on the home screen (S14d: achievements sit behind a tile, D-151).
      await expect(p.getByTestId('celebration')).toBeVisible();
      const subjects = p.getByRole('group', { name: 'My subject' });
      if (await subjects.count()) await subjects.getByRole('button', { name: 'English', exact: true }).click();
      await p.getByRole('link', { name: /^My achievements/u }).click();
      const earned = p.getByTestId('student-badge').filter({ hasText: badgeName });
      await expect(earned).toBeVisible();
      // Seen once: no celebration on the next visit.
      expect((await seen).status()).toBe(200);
      await p.reload();
      await expect(p.getByTestId('student-badge').filter({ hasText: badgeName })).toBeVisible();
      await expect(p.getByTestId('student-badge').filter({ hasText: badgeName })).not.toHaveAttribute('data-new', /.*/);
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
    await p.getByRole('link', { name: 'My avatar' }).click();
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

test('a group of this lesson ticks its members in the award dialog in one tap (S25a, D-185, UX-8, GRP-7)', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'checked once, on the display project');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true } }] });
  expect(started.body.results[0].ok).toBe(true);
  try {
    const lessonId = ((await api(page, 'GET', '/api/classroom/lessons/active')).body.lessons as Array<{ contextId: string; lessonId: string }>).find((l) => l.contextId === ctx.id)!.lessonId;
    const arrangements = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/grouping/arrangements`)).body.arrangements as Array<{ id: string }>;
    expect(arrangements.length, 'a saved grouping option').toBeGreaterThan(0);
    const applied = await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'grouping.apply', contextId: ctx.id, lessonId, payload: { contextId: ctx.id, lessonId, templateId: arrangements[0]!.id } }],
    });
    expect(applied.body.results[0].ok, JSON.stringify(applied.body.results[0])).toBe(true);
    type Group = { name: { en?: string }; members: Array<{ fullName: string }> };
    const state = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/lesson`)).body as { grouping: { groups: Group[] } };
    const shown = state.grouping.groups.filter((g) => g.members.length > 0);
    const group = shown[0]!;
    const members = group.members.map((m) => m.fullName);

    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    const view = await openDock(page, 'achievements');
    await view.getByTestId('achievements-give').click();
    const dialog = page.getByTestId('achievements-dialog');
    await expect(dialog.getByTestId('achievements-groups')).toBeVisible();
    await expect(dialog.getByTestId('achievements-group')).toHaveCount(shown.length);
    const button = dialog.getByTestId('achievements-group').filter({ hasText: group.name.en! }).first();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toContainText(members.length === 1 ? '1 student' : `${members.length} students`);
    // Names from the name span only: an avatar saved by an earlier spec may be a jersey with a "7" in its SVG,
    // which textContent would read as part of the name (a Linux CI flake, 2026-11-12).
    const checked = () => dialog.getByTestId('achievements-student').evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).map((e) => e.closest('label')!.querySelector(':scope > span:not([aria-hidden])')!.textContent!.trim()));
    // One tap ticks every member of the group, and nobody else ...
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect((await checked()).sort()).toEqual([...members].sort());
    await expect(dialog.getByTestId('achievements-confirm')).toHaveText(`Give to ${members.length}`);
    // ... a second tap unticks them; a student ticked by hand stays ticked.
    const other = dialog
      .locator('.cc-achievements-students label')
      .filter({ hasNotText: new RegExp(members.map((m) => m.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|'), 'u') })
      .first();
    await other.getByTestId('achievements-student').check();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(await checked()).toHaveLength(1);
    await button.click();
    expect(await checked()).toHaveLength(members.length + 1);
    const axe = await new AxeBuilder({ page }).include('[data-testid="achievements-groups"]').analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    // Given quietly to the group and the other student: one award command for exactly those students
    // (the server skips anyone who already had the achievement from an earlier spec).
    const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
    // The name span only: the avatar beside it is aria-hidden art that can hold text (a jersey's "7").
    const otherName = (await other.locator(':scope > span:not([aria-hidden])').innerText()).trim();
    const expected = roster.filter((s) => members.includes(s.fullName) || s.fullName === otherName).map((s) => s.id).sort();
    expect(expected).toHaveLength(members.length + 1);
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/commands') && r.method() === 'POST' && (r.postData() ?? '').includes('achievements.award'));
    await dialog.getByTestId('achievements-celebrate').uncheck();
    await dialog.getByTestId('achievements-badge').first().click();
    await dialog.getByTestId('achievements-confirm').click();
    await expect(dialog).toHaveCount(0);
    const body = (await sent).postDataJSON() as { commands: Array<{ type: string; payload: { studentIds: string[] } }> };
    expect(body.commands.find((c) => c.type === 'achievements.award')!.payload.studentIds.sort()).toEqual(expected);
    await expect(view.getByTestId('achievements-note')).not.toBeEmpty();
    await closeDock(page, 'achievements');
  } finally {
    await endActiveLessons(page);
  }
});
