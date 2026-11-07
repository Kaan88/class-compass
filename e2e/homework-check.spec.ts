/**
 * S13a bug 1a (feedback round 1, 2026-11-07): homework checking selections and bulk actions must apply to
 * the selected students, in the teacher area and in the classroom checking dialog (HW-3, HW-4, UX-9).
 * Fictional demo data only; the assignments are archived and the setting is put back afterwards.
 */
import { expect, test, type Page } from '@playwright/test';
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

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
}

async function serverStatuses(page: Page, assignmentId: string) {
  const check = (await api(page, 'GET', `/api/teacher/homework/${assignmentId}/check`)).body as { rows: Array<{ student: { fullName: string }; status: string }> };
  return new Map(check.rows.map((r) => [r.student.fullName, r.status]));
}

test('teacher area: selected students get the bulk status, select all works, undo restores', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const contextId = await context3A(page);
  const title = `E2E select ${randomUUID().slice(0, 6)}`;
  const today = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/homework?view=day`)).body.today as string;
  const assignmentId = (await api(page, 'POST', `/api/teacher/contexts/${contextId}/homework`, { contextId, title, dueOn: today })).body.id as string;
  try {
    await page.goto('/teacher/homework');
    const hp = page.getByTestId('homework-page');
    await hp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    const item = hp.getByTestId('homework-item').filter({ hasText: title });
    await item.getByRole('button', { name: `Check ${title}` }).click();
    const grid = item.getByTestId('homework-check');
    const rows = grid.getByTestId('homework-row');
    await expect(rows).toHaveCount(19);
    const names = await rows.locator('strong').allInnerTexts();

    // Tap two rows (the whole row is the target, not only the small box) and mark them Missing.
    await rows.nth(0).locator('strong').click();
    await expect(grid.getByRole('checkbox', { name: `Select ${names[0]}` })).toBeChecked();
    await expect(rows.nth(0)).toHaveAttribute('data-selected', '');
    await grid.getByRole('checkbox', { name: `Select ${names[2]}` }).click();
    await expect(grid.getByTestId('homework-selected')).toHaveText('2 selected');
    await expect(grid.getByRole('button', { name: /Apply to 2 selected/ })).toBeEnabled();
    await grid.getByLabel('Mark selected as').selectOption({ label: 'Missing' });
    await grid.getByRole('button', { name: /Apply to 2 selected/ }).click();
    await expect(grid.getByTestId('homework-summary')).toContainText('Missing 2');
    let st = await serverStatuses(page, assignmentId);
    expect(st.get(names[0]!)).toBe('missing');
    expect(st.get(names[2]!)).toBe('missing');
    expect(st.get(names[1]!)).toBe('not_checked');
    // The rows show the new status right away.
    await expect(grid.getByLabel(`Homework of ${names[0]}`)).toHaveValue('missing');

    // Select all → Completed overrides everyone.
    await grid.getByRole('button', { name: 'Select all' }).click();
    await grid.getByLabel('Mark selected as').selectOption({ label: 'Completed' });
    await grid.getByRole('button', { name: /Apply to 19 selected/ }).click();
    await expect(grid.getByTestId('homework-summary')).toContainText('Completed 19');
    st = await serverStatuses(page, assignmentId);
    expect([...st.values()].every((s) => s === 'completed')).toBe(true);

    // Undo the last batch: the two Missing marks come back.
    await page.getByRole('button', { name: 'Undo' }).last().click();
    await expect(grid.getByTestId('homework-summary')).toContainText('Missing 2');
  } finally {
    await api(page, 'POST', `/api/teacher/homework/${assignmentId}/archive`, { assignmentId, archived: true });
  }
});

test('classroom checking dialog: selected students and "mark the rest" apply', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const contextId = await context3A(page);
  const before = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/homework/settings`)).body as { checkingInClassroom: boolean };
  await api(page, 'PUT', `/api/teacher/contexts/${contextId}/homework/settings`, { contextId, checkingInClassroom: true });
  const title = `E2E room ${randomUUID().slice(0, 6)}`;
  const today = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/homework?view=day`)).body.today as string;
  const assignmentId = (await api(page, 'POST', `/api/teacher/contexts/${contextId}/homework`, { contextId, title, dueOn: today })).body.id as string;
  let started = false;
  try {
    const r = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId, payload: { contextId, othersPresent: true, attendance: [] } }] });
    started = r.body.results[0].ok === true;
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).first().click();
    const panel = page.getByTestId('homework-panel');
    await panel.getByRole('button', { name: `Check ${title}` }).click();
    const dialog = page.getByRole('dialog');
    const grid = dialog.getByTestId('homework-check');
    const rows = grid.getByTestId('homework-row');
    await expect(rows).toHaveCount(19);
    const names = await rows.locator('strong').allInnerTexts();
    // The last student on the list: tapping the name selects; the bulk bar stays in view (bug 1a).
    const last = rows.nth(18);
    await last.scrollIntoViewIfNeeded();
    await last.locator('strong').tap();
    await expect(grid.getByRole('checkbox', { name: `Select ${names[18]}` })).toBeChecked();
    await expect(grid.getByTestId('homework-bulk')).toBeInViewport();
    await expect(grid.getByRole('button', { name: /Apply to 1 selected/ })).toBeInViewport();
    await grid.getByLabel('Mark selected as').selectOption({ label: 'Partly completed' });
    await grid.getByRole('button', { name: /Apply to 1 selected/ }).tap();
    await expect(grid.getByTestId('homework-summary')).toContainText('Partly completed 1');
    await grid.getByRole('button', { name: 'Mark the rest' }).tap();
    await expect(grid.getByTestId('homework-summary')).toContainText('Completed 18');
    await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN });
    const st = await serverStatuses(page, assignmentId);
    expect(st.get(names[18]!)).toBe('partly_completed');
    expect([...st.values()].filter((s) => s === 'completed')).toHaveLength(18);
  } finally {
    if (started) await endActiveLessons(page);
    await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN });
    await api(page, 'POST', '/api/classroom/leave');
    await api(page, 'POST', `/api/teacher/homework/${assignmentId}/archive`, { assignmentId, archived: true });
    await api(page, 'PUT', `/api/teacher/contexts/${contextId}/homework/settings`, { contextId, checkingInClassroom: before.checkingInClassroom });
  }
});
