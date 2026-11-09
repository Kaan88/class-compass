/**
 * Grouping and Homework (S8: GRP-5..7, DSH-8, HW-1..4, UX-9). Fictional demo data only.
 * 1. 3-A (19 students), 2 marked absent at the start: open the full-screen group screen and choose
 *    the Dolphins option (mixed, Group 1-5). The 17 present students are in groups, the absent ones
 *    are not, and no level (set just before in the teacher area) reaches the display or any
 *    classroom response (GRP-7). S13a: Shuffle with undo, tap-to-move, drag-and-drop, Save to option.
 * 2. Teacher area: check a homework with "mark all remaining as Completed", then correct one student
 *    to Missing. Not-checked students are never counted as missing (HW-4).
 * Demo data is put back afterwards (attendance cleared, levels restored, the homework archived).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { api, closeDock, ensurePin, login, openDock, PIN } from './helpers.ts';

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function axe(page: Page, selector: string) {
  const r = await new AxeBuilder({ page }).include(selector).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
}

test('mixed groups for 19 students with 2 absent are shown on the display without levels', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const contextId = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${contextId}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  expect(roster).toHaveLength(19);
  const [absentA, absentB] = [roster[0]!, roster[1]!];

  // Teacher area (not in classroom mode yet): give some students a level (GRP-3), keep the old ones.
  const before = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/levels`)).body.levels as Array<{ studentId: string; level: string | null }>;
  const levelled = roster.slice(2, 8);
  const set = await api(page, 'PUT', `/api/teacher/contexts/${contextId}/levels`, { contextId, levels: levelled.map((s, i) => ({ studentId: s.id, level: `LVLE2E${i % 3}` })) });
  expect(set.status).toBe(200);

  const classroomBodies: Array<{ url: string; body: string }> = [];
  page.on('response', async (r) => {
    if (!r.url().includes('/api/classroom/')) return;
    try {
      classroomBodies.push({ url: r.url(), body: await r.text() });
    } catch {
      /* no body */
    }
  });

  let lessonId = '';
  try {
    const started = await api(page, 'POST', '/api/commands', {
      commands: [
        {
          opId: randomUUID(),
          type: 'lesson.start',
          contextId,
          payload: { contextId, othersPresent: true, attendance: [{ studentId: absentA.id, status: 'absent' }, { studentId: absentB.id, status: 'absent' }] },
        },
      ],
    });
    expect(started.body.results[0].ok).toBe(true);
    lessonId = ((await api(page, 'GET', '/api/classroom/lessons/active')).body.lessons as Array<{ contextId: string; lessonId: string }>).find((l) => l.contextId === contextId)!.lessonId;

    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    // Groups are a button in the board's dock (S14b, D-148), without a badge while no groups are shown.
    await expect(page.getByTestId('dock-groups')).toBeVisible();
    await expect(page.getByTestId('dock-groups').locator('.cc-dock__badge')).toHaveCount(0);

    // Two taps: Groups → an option on the full-screen group screen (GRP-5, D-098).
    const screen = await openDock(page, 'groups');
    await expect(screen.getByText('Choose an option above')).toBeVisible();
    await expect(screen.getByTestId('group-options').getByRole('button')).toHaveCount(4);
    await screen.getByTestId('group-options').getByRole('button', { name: /Dolphins/ }).click();
    const cards = screen.getByTestId('group-card');
    await expect(cards).toHaveCount(5);
    await expect(cards.first()).toContainText('Group 1');
    await expect(screen.getByTestId('group-options').getByRole('button', { name: /Dolphins/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(screen.getByText('2 absent students are not in a group this lesson.')).toBeVisible();
    // The timer is on the group screen too.
    await expect(screen.getByTestId('timer-compact')).toBeVisible();

    // The 17 present students are each in exactly one group; the absent ones are in none.
    const groupList = screen.locator('.cc-groups--screen');
    const text = await groupList.innerText();
    for (const s of roster.slice(2)) expect(text.split(s.fullName).length - 1, s.fullName).toBe(1);
    expect(text).not.toContain(absentA.fullName);
    expect(text).not.toContain(absentB.fullName);
    await expect(screen.getByTestId('group-member')).toHaveCount(17);
    const sizes = () => cards.evaluateAll((els) => els.map((e) => e.querySelectorAll('.cc-group__members > li').length));
    const first = await sizes();
    expect(Math.max(...first) - Math.min(...first)).toBeLessThanOrEqual(1);
    await axe(page, '[data-testid="dock-view-groups"]');

    // Shuffle makes new groups; Undo brings the previous ones back.
    const membersOf = () => cards.evaluateAll((els) => els.map((e) => [...e.querySelectorAll('[data-student-id]')].map((m) => m.getAttribute('data-student-id')).join(',')).join('|'));
    const beforeShuffle = await membersOf();
    await screen.getByRole('button', { name: 'Shuffle' }).click();
    await expect(screen.getByTestId('group-move-hint')).toHaveText('New groups made.');
    await expect.poll(membersOf).not.toBe(beforeShuffle);
    // Undo is on the group screen itself (the toast area is outside the full-screen dialog).
    await screen.getByTestId('group-undo').click();
    await expect.poll(membersOf).toBe(beforeShuffle);
    await expect(screen.getByTestId('group-undo')).toHaveCount(0);

    // Tap-to-move: tap a name, then "Move here" on another group; it applies at once.
    const firstMember = cards.nth(0).getByTestId('group-member').first();
    const movedId = (await firstMember.getAttribute('data-student-id'))!;
    await cards.nth(0).getByRole('button', { name: /^Move / }).first().click();
    await expect(screen.getByTestId('group-move-hint')).toContainText('Now tap the group for');
    await cards.nth(1).getByRole('button', { name: /^Move here: Group 2/ }).click();
    await expect(cards.nth(1).locator(`[data-student-id="${movedId}"]`)).toHaveCount(1);
    await expect(cards.nth(0).locator(`[data-student-id="${movedId}"]`)).toHaveCount(0);

    // Drag-and-drop: drag a name onto another group.
    const dragged = cards.nth(2).getByTestId('group-member').first();
    const draggedId = (await dragged.getAttribute('data-student-id'))!;
    await dragged.dragTo(cards.nth(3));
    await expect(cards.nth(3).locator(`[data-student-id="${draggedId}"]`)).toHaveCount(1);
    await expect(screen.getByTestId('group-member')).toHaveCount(17);

    // The moves are kept by the server: after a refresh the same groups come back (lesson state).
    const afterMoves = await membersOf();
    await screen.getByRole('button', { name: 'Save to option' }).click();
    await expect(screen.getByTestId('group-move-hint')).toHaveText('The groups are saved in this option for next time.');
    await page.reload();
    // The dock badge counts the groups in use.
    await expect(page.getByTestId('dock-groups').locator('.cc-dock__badge')).toHaveText('5');
    await openDock(page, 'groups');
    await expect(screen.getByTestId('group-member')).toHaveCount(17);
    await expect.poll(membersOf).toBe(afterMoves);
    await closeDock(page, 'groups');
    if (await page.getByTestId('dock-homework').count()) {
      await openDock(page, 'homework');
      await axe(page, '[data-testid="dock-view-homework"]');
      await closeDock(page, 'homework');
    }
    await openDock(page, 'groups');

    // No level anywhere on the display or in any classroom response (GRP-7).
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('LVLE2E');
    expect(await page.content()).not.toContain('LVLE2E');
    expect(classroomBodies.length).toBeGreaterThan(0);
    for (const b of classroomBodies) expect(b.body, b.url).not.toContain('LVLE2E');

    // Hide groups.
    await screen.getByRole('button', { name: 'Hide groups' }).click();
    await closeDock(page, 'groups');
    await expect(page.getByTestId('dock-groups').locator('.cc-dock__badge')).toHaveCount(0);
  } finally {
    // Put the demo data back: clear the two absences, restore the levels, end the lesson.
    if (lessonId) {
      for (const s of [absentA, absentB]) {
        await api(page, 'POST', '/api/commands', {
          commands: [{ opId: randomUUID(), type: 'attendance.setDaily', contextId, lessonId, payload: { contextId, lessonId, studentId: s.id, status: null } }],
        });
      }
    }
    await endActiveLessons(page);
    await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN });
    const old = new Map(before.map((l) => [l.studentId, l.level]));
    await api(page, 'PUT', `/api/teacher/contexts/${contextId}/levels`, { contextId, levels: levelled.map((s) => ({ studentId: s.id, level: old.get(s.id) ?? null })) });
    await api(page, 'POST', '/api/classroom/leave');
  }

  // Teacher area: the four default options (D-098), with the levels only here (GRP-1, GRP-7).
  await page.goto('/teacher/grouping');
  const gp = page.getByTestId('grouping-page');
  await expect(gp).toBeVisible();
  await gp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
  await expect(gp.getByTestId('arrangement')).toHaveCount(4);
  await expect(gp.getByTestId('arrangement').filter({ hasText: 'Dolphins' })).toBeVisible();
  await axe(page, '[data-testid="grouping-page"]');
  // The same tap-to-move editor in the teacher area.
  const lions = gp.getByTestId('arrangement').filter({ hasText: 'Lions' });
  await lions.getByRole('button', { name: 'Edit' }).click();
  const editor = gp.getByTestId('grouping-editor');
  await editor.getByTestId('editor-member').first().click();
  await expect(editor.getByTestId('editor-move-here').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
});

test('check homework with a bulk action, then correct one student', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const contextId = await context3A(page);
  const title = `E2E reading ${randomUUID().slice(0, 6)}`;
  const today = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/homework?view=day`)).body.today as string;
  const created = await api(page, 'POST', `/api/teacher/contexts/${contextId}/homework`, { contextId, title, dueOn: today });
  expect(created.status).toBe(200);
  const assignmentId = created.body.id as string;
  try {
    await page.goto('/teacher/homework');
    const hp = page.getByTestId('homework-page');
    await expect(hp).toBeVisible();
    await hp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    const item = hp.getByTestId('homework-item').filter({ hasText: title });
    await expect(item).toBeVisible();
    await expect(item.getByTestId('homework-summary')).toContainText('Not checked 19');
    await item.getByRole('button', { name: `Check ${title}` }).click();

    const grid = item.getByTestId('homework-check');
    await expect(grid.getByTestId('homework-row')).toHaveCount(19);
    // Nobody is "Missing" before checking (HW-4).
    await expect(grid.getByTestId('homework-summary')).not.toContainText('Missing');

    // Bulk: every student still not checked → Completed (HW-4), with an Undo toast (UX-9).
    await grid.getByLabel('Mark all 19 not checked as').selectOption({ label: 'Completed' });
    await grid.getByRole('button', { name: 'Mark the rest' }).click();
    await expect(page.getByText('19 homework marks saved.')).toBeVisible();
    await expect(grid.getByTestId('homework-summary')).toContainText('Completed 19');

    // Individual correction: one student → Missing.
    const firstName = (await grid.getByTestId('homework-row').first().locator('strong').innerText()).trim();
    await grid.getByLabel(`Homework of ${firstName}`).selectOption({ label: 'Missing' });
    await expect(grid.getByTestId('homework-summary')).toContainText('Completed 18');
    await expect(grid.getByTestId('homework-summary')).toContainText('Missing 1');
    await axe(page, '[data-testid="homework-page"]');

    // On the server: 18 completed, 1 missing, nobody left not checked.
    const check = (await api(page, 'GET', `/api/teacher/homework/${assignmentId}/check`)).body as { rows: Array<{ student: { fullName: string }; status: string }> };
    expect(check.rows.filter((r) => r.status === 'completed')).toHaveLength(18);
    expect(check.rows.filter((r) => r.status === 'missing').map((r) => r.student.fullName)).toEqual([firstName]);

    // The outstanding list shows the missing student.
    await hp.getByRole('tab', { name: 'Outstanding' }).click();
    await expect(page.getByTestId('homework-outstanding')).toContainText(firstName);
  } finally {
    await api(page, 'POST', `/api/teacher/homework/${assignmentId}/archive`, { assignmentId, archived: true });
  }
});
