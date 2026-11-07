/**
 * Grouping and Homework (S8: GRP-5..7, DSH-8, HW-1..4, UX-9). Fictional demo data only.
 * 1. 3-A (19 students), 2 marked absent at the start: choose mixed groups on the classroom display.
 *    The 17 present students are in groups, the absent ones are not, and no level (set just before
 *    in the teacher area) reaches the display or any classroom response (GRP-7).
 * 2. Teacher area: check a homework with "mark all remaining as Completed", then correct one student
 *    to Missing. Not-checked students are never counted as missing (HW-4).
 * Demo data is put back afterwards (attendance cleared, levels restored, the homework archived).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { api, ensurePin, login, PIN } from './helpers.ts';

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
    const panel = page.getByTestId('groups-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('No groups are shown in this lesson.')).toBeVisible();

    // Two taps: Choose groups → an arrangement (GRP-5).
    await panel.getByRole('button', { name: 'Choose groups' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Mixed teams A/ }).click();
    await expect(dialog).toHaveCount(0);
    const groups = panel.locator('.cc-group');
    await expect(groups.first()).toBeVisible();
    await expect(panel.getByText('2 absent students are not in a group this lesson.')).toBeVisible();

    // The 17 present students are each in exactly one group; the absent ones are in none.
    const text = await panel.innerText();
    for (const s of roster.slice(2)) expect(text.split(s.fullName).length - 1, s.fullName).toBe(1);
    expect(text).not.toContain(absentA.fullName);
    expect(text).not.toContain(absentB.fullName);
    const members = await panel.locator('.cc-group__members > li').count();
    expect(members).toBe(17);
    const sizes = await groups.evaluateAll((els) => els.map((e) => e.querySelectorAll('.cc-group__members > li').length));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

    // Refresh: the groups come back from the server (lesson state).
    await page.reload();
    await expect(page.getByTestId('groups-panel').locator('.cc-group__members > li')).toHaveCount(17);
    await axe(page, '[data-testid="groups-panel"]');
    if (await page.getByTestId('homework-panel').count()) await axe(page, '[data-testid="homework-panel"]');

    // No level anywhere on the display or in any classroom response (GRP-7).
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('LVLE2E');
    expect(await page.content()).not.toContain('LVLE2E');
    expect(classroomBodies.length).toBeGreaterThan(0);
    for (const b of classroomBodies) expect(b.body, b.url).not.toContain('LVLE2E');

    // Hide groups.
    await page.getByTestId('groups-panel').getByRole('button', { name: 'Hide groups' }).click();
    await expect(page.getByTestId('groups-panel').getByText('No groups are shown in this lesson.')).toBeVisible();
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

  // Teacher area: the five default arrangements, with the levels only here (GRP-1, GRP-7).
  await page.goto('/teacher/grouping');
  const gp = page.getByTestId('grouping-page');
  await expect(gp).toBeVisible();
  await gp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
  await expect(gp.getByTestId('arrangement')).toHaveCount(5);
  await axe(page, '[data-testid="grouping-page"]');
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
