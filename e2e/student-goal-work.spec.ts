/**
 * S27b (D-194, GOL-4, STU-2): a student adds work from My goals. "Add my work" on a goal opens the
 * shared evidence steps for that goal (how → the work, no "which goal" step); a written piece and a
 * picture are saved linked to that goal, and each time the child is back at the goal with a calm note
 * and the new work listed under it. On a 375 px phone, with axe on each screen. The photo flag is
 * switched on for the picture and off again in `finally`; the evidence is deleted and the goal
 * archived afterwards. Fictional demo data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { api, ensurePin, login, PASSWORD, studentLinkUrl } from './helpers.ts';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
type Rostered = { id: string; fullName: string };

async function seriousViolations(page: Page) {
  // Let short entrance animations (a toast fading in) finish, so axe measures the final colours.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function setPhotos(browser: Browser, on: boolean) {
  const ctx = await browser.newContext();
  try {
    const admin = await ctx.newPage();
    await login(admin, 'admin', PASSWORD);
    expect((await api(admin, 'PUT', '/api/admin/module-policies/media.evidencePhotos', { availability: on ? 'enabled' : 'disabled' })).status).toBe(200);
  } finally {
    await ctx.close();
  }
}

test('a student adds a written piece and a picture to a goal from My goals and sees them under that goal (375 px, axe)', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'the phone width is set here, once, on the display project');
  test.setTimeout(150_000);
  await login(page, 'english');
  await ensurePin(page);
  const contexts = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  const ctx = contexts.find((c) => c.className === '3-B' && c.subjectName.en === 'English')!;
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Rostered[];
  const student = roster[15] ?? roster.at(-1)!;
  const library = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/goal-library`)).body as { categories: Array<{ id: string; archived: boolean }> };
  const goalText = 'I will draw a picture of every fictional story I read.';
  const goal = await api(page, 'POST', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`, { categoryId: library.categories.find((c) => !c.archived)!.id, text: goalText });
  expect(goal.status).toBe(200);
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-GB' });
  const added: string[] = [];
  let p: Page | null = null;
  try {
    await setPhotos(browser, true);
    p = await phone.newPage();
    await p.goto(url);
    await expect(p.getByTestId('student-page')).toBeVisible();
    const subjects = p.getByRole('group', { name: 'My subject' });
    if (await subjects.count()) await subjects.getByRole('button', { name: 'English', exact: true }).click();
    await p.getByRole('link', { name: 'My goals' }).click();
    const card = () => p!.getByTestId('student-goal').filter({ hasText: goalText });
    const addWork = () => card().getByRole('button', { name: `Add my work: ${goalText}` });
    await expect(addWork()).toBeVisible();
    // A full touch target (UX-6: at least var(--cc-touch), 56 px).
    expect((await addWork().boundingBox())!.height).toBeGreaterThanOrEqual(56);
    expect(await seriousViolations(p)).toEqual([]);

    // 1. Something written: how → the work, for this goal (no "which goal" step).
    await addWork().click();
    const form = p.getByTestId('evidence-form');
    await expect(form).toHaveAttribute('data-step', 'how');
    await expect(form.getByTestId('evidence-for-goal')).toHaveText(`Goal: ${goalText}`);
    await expect(form.getByRole('button', { name: 'Add a picture', exact: true })).toBeVisible();
    expect(await seriousViolations(p)).toEqual([]);
    await form.getByRole('button', { name: 'Write', exact: true }).click();
    await expect(form).toHaveAttribute('data-step', 'work');
    await form.getByLabel('Write about your work').fill('I drew the dragon from our fictional story.');
    expect(await seriousViolations(p)).toEqual([]);
    await form.getByRole('button', { name: 'Save my work' }).click();

    // Back at the goal: the calm note, the work under the goal, the focus on its "Add my work".
    await expect(card().getByRole('status')).toHaveText('Your work is saved with this goal.');
    await expect(card().getByTestId('student-goal-work')).toContainText('I drew the dragon from our fictional story.');
    await expect(addWork()).toBeFocused();
    expect(new URL(p.url()).searchParams.get('step')).toBeNull();
    expect(await seriousViolations(p)).toEqual([]);

    // 2. A picture with a few words.
    await addWork().click();
    await expect(form).toHaveAttribute('data-step', 'how');
    await form.getByRole('button', { name: 'Add a picture', exact: true }).click();
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .png()
      .toBuffer();
    await form.getByLabel('Choose pictures').setInputFiles({ name: 'dragon.png', mimeType: 'image/png', buffer: png });
    await expect(form.getByTestId('evidence-pending').getByRole('listitem')).toHaveCount(1);
    await form.getByLabel('A few words (you can skip this)').fill('My dragon drawing');
    expect(await seriousViolations(p)).toEqual([]);
    await form.getByRole('button', { name: 'Save my work' }).click();
    const work = card().getByTestId('student-goal-work');
    await expect(work.locator('[data-kind="picture"]').filter({ hasText: 'My dragon drawing' })).toBeVisible();
    await expect(work.getByRole('listitem')).toHaveCount(2);
    await expect(card().getByRole('status')).toBeVisible();
    expect(await seriousViolations(p)).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // The teacher sees both, linked to the goal.
    const detail = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`)).body as { evidence: Array<{ id: string; goalId: string | null; kind: string; body: string | null }> };
    const linked = detail.evidence.filter((e) => e.goalId === goal.body.id);
    added.push(...linked.map((e) => e.id));
    expect(linked.map((e) => e.body).sort()).toEqual(['I drew the dragon from our fictional story.', 'My dragon drawing']);
  } finally {
    for (const id of added) if (p) expect((await api(p, 'DELETE', `/api/student/evidence/${id}`)).status).toBe(200);
    await phone.close();
    await setPhotos(browser, false);
    expect((await api(page, 'PATCH', `/api/teacher/goals/${goal.body.id}`, { status: 'archived' })).status).toBe(200);
  }
});
