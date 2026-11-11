/**
 * S20b (D-170, GOL-4): a teacher adds evidence from the Goals page. "Add evidence" on a goal card
 * opens the evidence form for that goal; a document goes up through the S9 teacher upload endpoint
 * and is listed under Evidence with its goal; the student page shows it as the teacher's. With the
 * media flags off (the demo default) the form offers no picture or voice choices. The upload request
 * carries the class+subject and the student (so the Goals checks run before storing), and the
 * "Add evidence" button is a full touch target. Axe on the page.
 * Fictional demo data only; the goal is archived and the evidence deleted afterwards.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
type Rostered = { id: string; fullName: string };

async function seriousViolations(page: Page, include?: string) {
  // Let short entrance animations (a toast fading in) finish, so axe measures the final colours.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('the teacher adds a document as evidence for a goal from the Goals page and sees it listed @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const project = test.info().project.name;
  await login(page, 'english');
  await ensurePin(page);
  const contexts = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  const ctx = contexts.find((c) => c.className === '3-B' && c.subjectName.en === 'English')!;
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Rostered[];
  const student = roster[project === 'mobile' ? 11 : 10]!;
  const library = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/goal-library`)).body as { categories: Array<{ id: string; archived: boolean }> };
  const goalText = `I will keep a reading log (${project}).`;
  const goal = await api(page, 'POST', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`, { categoryId: library.categories.find((c) => !c.archived)!.id, text: goalText });
  expect(goal.status).toBe(200);
  const fileName = `reading-log-${project}.txt`;
  let evidenceId: string | undefined;
  try {
    await page.goto(`/teacher/goals?contextId=${ctx.id}&studentId=${student.id}`);
    const view = page.getByTestId('teacher-student-goals');
    await expect(view.getByRole('heading', { name: student.fullName })).toBeVisible();

    // "Add evidence" on the goal card: the form is now for that goal and the focus is on Evidence.
    const card = view.getByTestId('teacher-goal').filter({ hasText: goalText });
    const addEvidence = card.getByRole('button', { name: `Add evidence: ${goalText}` });
    // The way into the flow is a full-size touch target (UX-6: at least var(--cc-touch), 56 px).
    expect((await addEvidence.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await addEvidence.click();
    await expect(page.locator('#goals-evidence')).toBeFocused();
    const form = view.getByTestId('evidence-form');
    await expect(form.getByLabel('For which goal?')).toHaveValue(goal.body.id);
    // Media flags off (demo default): no picture or voice choices; documents are on.
    await expect(form.getByRole('button', { name: 'Add a picture' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Record my voice' })).toHaveCount(0);
    await form.getByRole('button', { name: 'Add a document' }).click();
    await form.getByLabel('Choose documents').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('Week 1: read 12 pages of a fictional story.\n') });
    await expect(form.getByTestId('evidence-pending')).toContainText(fileName);
    await form.getByLabel('A few words about it (optional)').fill('Reading log from class');
    expect(await seriousViolations(page, '[data-testid="teacher-student-goals"]')).toEqual([]);
    // The page names its class+subject on the upload, so the Goals checks run before the file is stored (D-170).
    const uploadRequest = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/files');
    await form.getByRole('button', { name: 'Add evidence', exact: true }).click();
    const uploadParams = new URL((await uploadRequest).url()).searchParams;
    expect(uploadParams.get('contextId')).toBe(ctx.id);
    expect(uploadParams.get('ownerStudentId')).toBe(student.id);
    expect(uploadParams.get('kind')).toBe('document');

    const item = view.locator('li.cc-evidence').filter({ hasText: fileName });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Reading log from class');
    await expect(item).toContainText(`Goal: ${goalText}`);
    await expect(item.getByText('Teacher', { exact: true })).toBeVisible();
    await expect(form.getByTestId('evidence-pending')).toHaveCount(0);
    expect(await seriousViolations(page, '[data-testid="teacher-student-goals"]')).toEqual([]);
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(0);

    const detail = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`)).body as { evidence: Array<{ id: string; goalId: string | null; file: { name: string } | null }> };
    const saved = detail.evidence.find((e) => e.file?.name === fileName)!;
    evidenceId = saved.id;
    expect(saved.goalId).toBe(goal.body.id);

    // The student sees it on their own page, marked as the teacher's.
    const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-GB' });
    try {
      const p = await phone.newPage();
      await p.goto(await studentLinkUrl(page, ctx.classId, student.id));
      await expect(p.getByTestId('student-page')).toBeVisible();
      const subjects = p.getByRole('group', { name: 'My subject' });
      if (await subjects.count()) await subjects.getByRole('button', { name: 'English', exact: true }).click();
      await p.getByRole('link', { name: 'Show my work' }).click();
      const mine = p.getByTestId('student-evidence').getByRole('listitem').filter({ hasText: fileName });
      await expect(mine.getByText('Teacher', { exact: true })).toBeVisible();
    } finally {
      await phone.close();
    }
  } finally {
    if (evidenceId) expect((await api(page, 'DELETE', `/api/teacher/evidence/${evidenceId}`)).status).toBe(200);
    expect((await api(page, 'PATCH', `/api/teacher/goals/${goal.body.id}`, { status: 'archived' })).status).toBe(200);
  }
});
