/**
 * S22b (D-176): a student changes the words of their own goal and of a reflection on the student page
 * (375×812, sentence starters, the check on Save, axe in English and Turkish) and the teacher sees the
 * new words; a teacher renames a default goal category in the Goals library (class languages,
 * "Use the school name") and the student page shows the new name. Fictional demo data only: the goal
 * is deleted and the category name restored afterwards.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
type Rostered = { id: string; fullName: string };
const READING = '00000000-0000-7000-8000-00000000c001';

async function seriousViolations(page: Page) {
  // Let short entrance animations (a toast fading in) finish, so axe measures the final colours.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}
const noSideScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function context3A(page: Page): Promise<Ctx> {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
}

test('a student changes the words of their own goal and reflection on a phone; the teacher sees the new words @mobile', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const project = test.info().project.name;
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Rostered[];
  const student = roster[project === 'mobile' ? 13 : 12]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  // Turkish on as a second language for the check in Turkish (switched back in finally: shared demo data).
  const setLanguage = async (secondLanguageEnabled: boolean) => expect((await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled })).status).toBe(200);
  await setLanguage(true);

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const p = await phone.newPage();
  let goalId: string | undefined;
  const oldGoal = `I will read a short comic every week (${project}).`;
  const newGoal = `I will read two short comics every week (${project}).`;
  try {
    await p.goto(url);
    await expect(p.getByTestId('student-page')).toBeVisible();
    // The goal and a reflection, written earlier through the student's own session.
    const subjectId = ((await api(p, 'GET', '/api/student/page')).body.subjects as Array<{ subjectId: string; name: { en: string } }>).find((x) => x.name.en === 'English')!.subjectId;
    const created = await api(p, 'POST', '/api/student/goals', { subjectId, categoryId: READING, text: oldGoal });
    expect(created.status).toBe(200);
    goalId = created.body.id as string;
    expect((await api(p, 'POST', `/api/student/goals/${goalId}/entries`, { kind: 'reflection', body: 'Today I read a funny story about a cat.' })).status).toBe(200);
    await p.reload();
    await expect(p.getByTestId('student-page')).toBeVisible();

    const subjects = p.getByRole('group', { name: 'My subject' });
    if (await subjects.count()) await subjects.getByRole('button', { name: 'English', exact: true }).click();
    await p.getByRole('navigation', { name: 'What do you want to do?' }).getByRole('link', { name: 'My goals' }).click();
    const card = p.getByTestId('student-goal').filter({ hasText: oldGoal });
    await expect(card).toBeVisible();

    // ---- The goal: "Change my words" opens the editor in place with the words and the starters.
    const changeGoal = card.locator(`[data-edit-for="${goalId}"]`);
    await expect(changeGoal).toHaveText('Change my words');
    expect((await changeGoal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await changeGoal.click();
    const editor = card.getByTestId('student-edit-words');
    const box = editor.getByLabel('My goal');
    await expect(box).toHaveValue(oldGoal);
    await expect(box).toBeFocused();
    await expect(editor.getByTestId('sentence-starters')).toBeVisible();
    expect(await noSideScroll(p), 'horizontal scroll with the editor open').toBeLessThanOrEqual(0);
    await p.screenshot({ path: `test-results/s22b/student-edit-${project}.png`, fullPage: true });
    expect(await seriousViolations(p)).toEqual([]);
    // Too short: the hint shows only when Save is pressed, and nothing is sent.
    await box.fill('read');
    await expect(editor.locator('.cc-field__error')).toHaveCount(0);
    await editor.getByRole('button', { name: 'Save my words' }).click();
    await expect(editor.locator('.cc-field__error')).not.toBeEmpty();
    await box.fill(newGoal);
    await editor.getByRole('button', { name: 'Save my words' }).click();
    await expect(p.getByText('Changed!')).toBeVisible();
    await expect(card.getByTestId('student-edit-words')).toHaveCount(0);
    await expect(p.getByTestId('student-goal').filter({ hasText: newGoal })).toBeVisible();
    await expect(p.getByTestId('student-goal').filter({ hasText: newGoal }).locator(`[data-edit-for="${goalId}"]`)).toBeFocused();

    // ---- The reflection: same editor, its own starters; Cancel keeps the words.
    const goalCard = p.getByTestId('student-goal').filter({ hasText: newGoal });
    const entry = goalCard.locator('li.cc-entry').filter({ hasText: 'Today I read a funny story about a cat.' });
    await entry.getByRole('button', { name: 'Change my words' }).click();
    const entryBox = entry.getByTestId('student-edit-words').getByLabel('My words');
    await expect(entryBox).toHaveValue('Today I read a funny story about a cat.');
    await entry.getByRole('button', { name: 'Cancel' }).click();
    await expect(entry.getByRole('button', { name: 'Change my words' })).toBeFocused();
    await entry.getByRole('button', { name: 'Change my words' }).click();
    await goalCard.getByLabel('My words').fill('Today I read a funny story about a cat and a dog.');
    await goalCard.getByRole('button', { name: 'Save my words' }).click();
    await expect(goalCard.locator('li.cc-entry').filter({ hasText: 'Today I read a funny story about a cat and a dog.' })).toBeVisible();

    // ---- In Turkish too.
    await p.getByRole('button', { name: 'Türkçe' }).click();
    await expect(p.locator('html')).toHaveAttribute('lang', 'tr');
    await goalCard.locator(`[data-edit-for="${goalId}"]`).click();
    await expect(goalCard.getByRole('button', { name: 'Sözlerimi kaydet' })).toBeVisible();
    await expect(goalCard.getByLabel('Hedefim')).toHaveValue(newGoal);
    expect(await noSideScroll(p), 'horizontal scroll in Turkish').toBeLessThanOrEqual(0);
    expect(await seriousViolations(p)).toEqual([]);
    await goalCard.getByRole('button', { name: 'Vazgeç' }).click();

    // ---- The teacher sees the new words.
    const detail = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`)).body as { goals: Array<{ id: string; text: string; entries: Array<{ body: string }> }> };
    const seen = detail.goals.find((g) => g.id === goalId)!;
    expect(seen.text).toBe(newGoal);
    expect(seen.entries.map((e) => e.body)).toEqual(['Today I read a funny story about a cat and a dog.']);
    await page.goto(`/teacher/goals?contextId=${ctx.id}&studentId=${student.id}`);
    await expect(page.getByTestId('teacher-goal').filter({ hasText: newGoal })).toBeVisible();
  } finally {
    if (goalId) expect((await api(p, 'DELETE', `/api/student/goals/${goalId}`)).status).toBe(200);
    await phone.close();
    await setLanguage(false);
  }
});

test('a teacher renames a default goal category for their classes; students see the new name; the school name comes back', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'one run: the category name is shared demo state');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Rostered[];
  try {
    await page.goto(`/teacher/goals?contextId=${ctx.id}`);
    await page.getByRole('tab', { name: 'Categories and preset goals' }).click();
    const card = page.getByTestId('library-category').filter({ has: page.getByRole('heading', { name: 'Reading', exact: true }) });
    await card.getByRole('button', { name: 'Rename: Reading' }).click();
    const form = card.getByTestId('category-rename');
    await expect(form.getByRole('heading', { name: 'Rename "Reading"' })).toBeVisible();
    // One field per language of the teacher's classes in this subject, the main language first.
    const en = form.getByLabel(/^Name \(English\)/u);
    await expect(en).toBeFocused();
    await en.fill('Reading club');
    await card.screenshot({ path: 'test-results/s22b/category-rename.png' });
    expect(await seriousViolations(page)).toEqual([]);
    await form.getByRole('button', { name: 'Save' }).click();
    const renamed = page.getByTestId('library-category').filter({ has: page.getByRole('heading', { name: 'Reading club', exact: true }) });
    await expect(renamed.getByText('Your name')).toBeVisible();
    await expect(renamed.getByRole('button', { name: 'Rename: Reading club' })).toBeFocused();

    // A student of the class chooses from the new name.
    const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-GB' });
    try {
      const p = await phone.newPage();
      await p.goto(await studentLinkUrl(page, ctx.classId, roster[14]!.id));
      await expect(p.getByTestId('student-page')).toBeVisible();
      const subjects = p.getByRole('group', { name: 'My subject' });
      if (await subjects.count()) await subjects.getByRole('button', { name: 'English', exact: true }).click();
      await p.getByRole('link', { name: 'New goal' }).click();
      await expect(p.getByRole('button', { name: 'Reading club' })).toBeVisible();
    } finally {
      await phone.close();
    }

    // Back to the school name.
    await renamed.getByRole('button', { name: 'Rename: Reading club' }).click();
    await expect(renamed.getByText('School name: Reading')).toBeVisible();
    await renamed.getByRole('button', { name: 'Use the school name' }).click();
    await expect(page.getByTestId('library-category').filter({ has: page.getByRole('heading', { name: 'Reading', exact: true }) })).toBeVisible();
  } finally {
    expect((await api(page, 'PATCH', `/api/teacher/goal-categories/${READING}`, { contextId: ctx.id, resetName: true })).status).toBe(200);
  }
});
