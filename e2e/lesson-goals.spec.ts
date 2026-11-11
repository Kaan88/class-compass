/**
 * Lesson goals (S25d, D-188; LES-1, LES-3, DSH-4, RPT-1, CFG-1): the teacher turns Lesson goals on for
 * 3-A English, starts a lesson with a goal, the board shows it to the class and it is changed during the
 * lesson, End Lesson asks "Did we reach our goal?", and the report lists the goal with the answer.
 * The module is switched off again in `finally` (the e2e suite shares one database). Fictional data only.
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

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
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), selector).toEqual([]);
}

test('start a lesson with a goal, see it on the board, change it, answer it at the end, find it in the report', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  // Settings and the report go through a second session: the display's session is in classroom mode.
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  const contexts = (await api(office, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string }; modules: Record<string, boolean> }>;
  const ctx = contexts.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  // Off by default in every class+subject (CFG-1, D-188).
  expect(ctx.modules.lessonGoals).toBe(false);
  await endActiveLessons(page);
  const goal = `We can ask and answer about the weather ${randomUUID().slice(0, 4)}.`;
  const changed = `We can describe today's weather ${randomUUID().slice(0, 4)}.`;
  try {
    expect((await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/lessonGoals`, { enabled: true })).status).toBe(200);

    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    await expect(page.getByTestId('no-lesson')).toBeVisible();
    await page.getByRole('button', { name: 'Start lesson' }).click();
    const start = page.getByTestId('start-lesson');
    await expect(start).toBeVisible();
    // Step through to "Today's goal" (after the topic), type the goal, then on to Begin (LES-1).
    await expect(start.getByRole('listitem').filter({ hasText: "Today's goal" })).toHaveCount(1);
    const goalStep = start.getByTestId('lesson-goal-step');
    for (let i = 0; i < 6 && !(await goalStep.isVisible()); i++) await start.getByRole('button', { name: 'Next', exact: true }).click();
    await goalStep.getByLabel('Our goal today (optional)').fill(goal);
    for (let i = 0; i < 6 && (await start.getByRole('button', { name: 'Begin lesson' }).count()) === 0; i++) await start.getByRole('button', { name: 'Next', exact: true }).click();
    await start.getByRole('button', { name: 'Begin lesson' }).click();

    // The board shows the goal to the class (DSH-4).
    const box = page.getByTestId('lesson-goal');
    await expect(box).toContainText("Today's goal");
    await expect(box).toContainText(goal);
    await expect(page.locator('[data-box="lessonGoal"]')).toHaveCount(1);
    await axe(page, '[data-box="lessonGoal"]');

    // Changed during the lesson ('lessonGoals.set', an outbox command naming the lesson).
    await box.getByRole('button', { name: 'Change' }).click();
    const dialog = page.getByTestId('lesson-goal-dialog');
    await dialog.getByLabel('Our goal today (optional)').fill(changed);
    await axe(page, '[data-testid="lesson-goal-dialog"]');
    await dialog.getByRole('button', { name: 'Save goal' }).click();
    await expect(box).toContainText(changed);
    // A reload reads it back from the server.
    await page.reload();
    await expect(page.getByTestId('lesson-goal')).toContainText(changed);

    // End Lesson: "Did we reach our goal?" before the reflection (LES-3).
    await page.getByRole('button', { name: 'End lesson', exact: true }).click();
    const end = page.getByTestId('end-lesson');
    const review = end.getByTestId('lesson-goal-review');
    await expect(review).toContainText(changed);
    await review.getByRole('radio', { name: 'Yes, we did!' }).click();
    await expect(review.getByRole('radio', { name: 'Yes, we did!' })).toHaveAttribute('aria-checked', 'true');
    await axe(page, '[data-testid="lesson-goal-review"]');
    await end.getByRole('button', { name: 'Save and end lesson' }).click();
    await expect(page.getByTestId('lesson-summary')).toBeVisible();

    // The report lists the goal with the class's answer (RPT-1).
    await office.goto(`/teacher/reports?contextId=${ctx.id}`);
    const section = office.locator('details[data-section="lessonGoals"]');
    await expect(section).toHaveCount(1);
    await expect(section).toContainText('Lesson goals');
    await expect(section).toContainText(changed);
    await expect(section).toContainText('Yes, we did!');
  } finally {
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/lessonGoals`, { enabled: false });
    await officeCtx.close();
  }
});
