/**
 * Forgotten lessons (S37, D-218) in the browser, with the server's test clock (NODE_ENV=test only).
 * A lesson in use is never cut off: at 91 minutes (quiet since the start) the teacher menu says it is
 * still running, and Still teaching hides it (activity); 16 quiet minutes later it is back and its End
 * lesson opens End Lesson for that class; the board then shows its note floating above the dock (the
 * student grid keeps its height) and Still teaching there hides it too; 30 quiet minutes after that the
 * polling board goes back to "no lesson" by itself, and another device of the teacher shows "ended by
 * itself" until Got it (which holds after a reload). Uses the demo teacher `classroom3a`, whom no other
 * spec signs in as, so its notifications cannot change another spec's bell; the English teacher's
 * running lessons are ended first, and the clock is put back in `finally`. Fictional demo data only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

const MIN = 60_000;
const clockFile = path.join(os.tmpdir(), `cc-e2e-clock-${process.env.E2E_PORT}`);
/** The server re-reads the offset at most every 200 ms. */
const setServerClockOffset = async (page: Page, ms: number) => {
  fs.writeFileSync(clockFile, String(ms));
  await page.waitForTimeout(400);
};

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

test('a forgotten lesson: the reminder and Still teaching on the teacher menu and the board, then it ends by itself', async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Three hours later must still be the same school day in Istanbul (UTC+3), or the midnight cap would end it first.
  test.skip(new Date(Date.now() + 3 * 3600_000).getUTCHours() >= 20, 'too close to midnight in Istanbul for a three-hour jump');
  const other = await browser.newContext();
  const english = await other.newPage();
  await login(english, 'english');
  await endActiveLessons(english);

  await login(page, 'classroom3a');
  await ensurePin(page);
  await endActiveLessons(page);
  const contexts = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  const ctx = contexts[0]!;
  const label = `${ctx.className} · ${ctx.subjectName.en}`;
  try {
    const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true } }] });
    expect(started.body.results[0].ok).toBe(true);

    // 91 minutes, quiet since the start: the teacher menu reminds; Still teaching hides it.
    await setServerClockOffset(page, 91 * MIN);
    await page.goto('/teacher');
    const running = page.getByTestId('lesson-notice-running');
    await expect(running).toContainText(`Your lesson in ${label} is still running since`);
    await expect(running).toContainText('If nothing happens in it, it ends by itself at');
    await running.getByRole('button', { name: 'Still teaching' }).click();
    await expect(running).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('teacher-menu')).toBeVisible();
    await expect(page.getByTestId('lesson-notice-running')).toHaveCount(0);

    // 16 quiet minutes later it is back; End lesson opens End Lesson for that class.
    await setServerClockOffset(page, 108 * MIN);
    await page.reload();
    await page.getByTestId('lesson-notice-running').getByRole('link', { name: 'End lesson' }).click();
    await expect(page).toHaveURL(/\/classroom$/u);
    await expect(page.getByTestId('end-lesson')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the lesson' }).click();
    await expect(page.getByTestId('lesson-dashboard')).toBeVisible();

    // Opening End Lesson was activity: 16 more quiet minutes before the board shows its note.
    await setServerClockOffset(page, 125 * MIN);
    await page.reload();
    const grid = page.getByTestId('lesson-dashboard');
    await expect(grid).toBeVisible();
    const note = page.getByTestId('lesson-overdue-note');
    await expect(note).toContainText('This lesson is still running.', { timeout: 20_000 });
    // It floats above the dock: the board keeps its height and the note covers none of the dock.
    const withNote = await grid.boundingBox();
    const noteBox = (await note.boundingBox())!;
    const dockBox = (await page.locator('.cc-dock').first().boundingBox())!;
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(dockBox.y + 1);
    await note.getByRole('button', { name: 'Still teaching' }).click();
    await expect(note).toHaveCount(0);
    expect(await grid.boundingBox()).toEqual(withNote);

    // 30 quiet minutes after Still teaching: the polling board shows the end by itself.
    await setServerClockOffset(page, 156 * MIN);
    await expect(page.getByTestId('no-lesson')).toBeVisible({ timeout: 20_000 });

    // Another device of the same teacher: the notice until Got it, and gone after a reload.
    const tablet = await browser.newContext();
    const t = await tablet.newPage();
    await login(t, 'classroom3a');
    await t.goto('/teacher');
    const ended = t.getByTestId('lesson-notice-auto-ended');
    await expect(ended).toContainText(`The lesson in ${label} on`);
    await expect(ended).toContainText('ended by itself');
    await expect(ended).toContainText('Anything you did not finish in End Lesson was left empty.');
    await ended.getByRole('button', { name: 'Got it' }).click();
    await expect(ended).toHaveCount(0);
    await t.reload();
    await expect(t.getByTestId('teacher-menu')).toBeVisible();
    await expect(t.getByTestId('lesson-notice-auto-ended')).toHaveCount(0);
    await tablet.close();
  } finally {
    await setServerClockOffset(page, 0);
    await endActiveLessons(page);
    await other.close();
  }
});
