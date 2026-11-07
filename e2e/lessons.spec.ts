/**
 * Lesson lifecycle on the classroom display (ENG-3, LES-1..4, DSH-1..8, ATT-1/2, D-006): start a
 * lesson with 19 students on a 1920×1080 touch screen, refresh resumes the same lesson and stage,
 * switching class and back keeps each class's state, and an attendance tap made offline is queued
 * and synced exactly once (one audit entry, no duplicates). Fictional demo data only.
 */
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { api, ensurePin, login } from './helpers.ts';

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

const stageOnServer = async (page: Page, lessonId: string) => {
  const r = await api(page, 'GET', '/api/classroom/lessons/active');
  return ((r.body?.lessons ?? []) as Array<{ lessonId: string; stageIndex: number }>).find((l) => l.lessonId === lessonId)?.stageIndex ?? -1;
};

test('start a lesson with 19 students, resume after refresh, switch classes, offline attendance syncs once', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  try {
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    await expect(page.getByTestId('class-banner-class')).toHaveText('3-A');

    // Start Lesson: attendance (everyone present by default) → routine → begin (LES-1).
    await expect(page.getByTestId('no-lesson')).toBeVisible();
    await page.getByRole('button', { name: 'Start lesson' }).click();
    const start = page.getByTestId('start-lesson');
    await expect(start).toBeVisible();
    await expect(start.locator('.cc-att-item')).toHaveCount(19);
    await expect(start.getByTestId('attendance-counts')).toHaveText('19 Present');
    await start.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(start.getByRole('radio').first()).toBeVisible();
    await start.getByRole('button', { name: 'Begin lesson' }).click();

    const dashboard = page.getByTestId('lesson-dashboard');
    await expect(dashboard).toBeVisible();
    const lessonId = (await dashboard.getAttribute('data-lesson-id'))!;
    expect(lessonId).toBeTruthy();
    await expect(page.getByTestId('current-stage')).toContainText('stage 1 of 6');
    await expect(page.getByTestId('lesson-in-progress')).toHaveCount(1);

    // Next stage, then refresh: the same lesson resumes at the same stage (LES-2).
    await page.getByRole('button', { name: 'Next stage' }).click();
    await expect(page.getByTestId('current-stage')).toContainText('stage 2 of 6');
    await expect.poll(() => stageOnServer(page, lessonId)).toBe(1);
    await page.reload();
    await expect(page.getByTestId('lesson-dashboard')).toHaveAttribute('data-lesson-id', lessonId);
    await expect(page.getByTestId('current-stage')).toContainText('stage 2 of 6');

    // Switch to 3-B (no lesson there) and back: 3-A keeps its lesson and stage (LES-4).
    await page.getByRole('button', { name: /3-B · English/ }).click();
    await expect(page.getByTestId('class-banner-class')).toHaveText('3-B');
    await expect(page.getByTestId('no-lesson')).toBeVisible();
    await expect(page.getByRole('button', { name: /3-A · English/ }).getByTestId('lesson-in-progress')).toBeVisible();
    await page.getByRole('button', { name: /3-A · English/ }).click();
    await expect(page.getByTestId('lesson-dashboard')).toHaveAttribute('data-lesson-id', lessonId);
    await expect(page.getByTestId('current-stage')).toContainText('stage 2 of 6');

    // Offline attendance tap: queued on the device, then synced exactly once (D-006, ATT-1).
    await login(admin, 'admin');
    const since = Date.now();
    await page.context().setOffline(true);
    await page.getByRole('button', { name: 'Attendance', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const first = dialog.locator('.cc-att-item').first();
    const label = (await first.getAttribute('aria-label'))!;
    const name = label.split(':')[0]!;
    await first.click();
    await expect(dialog.getByRole('button', { name: `${name}: Absent. Tap to change.` })).toBeVisible();
    await expect(page.getByText('Offline – 1 change waiting')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    const auditCount = async () => {
      const r = await api(admin, 'GET', `/api/admin/audit?entity=attendance_daily&action=attendance.set_daily&from=${since}&pageSize=200`);
      return (r.body?.items ?? []).length as number;
    };
    expect(await auditCount()).toBe(0);
    await page.context().setOffline(false);
    await expect.poll(auditCount, { timeout: 20_000 }).toBe(1);
    await expect(page.getByText('Offline – 1 change waiting')).toHaveCount(0);
    // Give any duplicate send a chance to show up, then check again.
    await page.waitForTimeout(2_000);
    expect(await auditCount()).toBe(1);
    const items = (await api(admin, 'GET', `/api/admin/audit?entity=attendance_daily&from=${since}&pageSize=200`)).body.items as Array<{ actorName: string; after: { status: string } }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.after.status).toBe('absent');

    // After a refresh the change is still there (server state, not only the device).
    await page.reload();
    await page.getByRole('button', { name: 'Attendance', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: `${name}: Absent. Tap to change.` })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  } finally {
    await page.context().setOffline(false);
    await endActiveLessons(page);
    await adminCtx.close();
  }
});
