/**
 * Student name → statistics (S14e2, D-154). Fictional demo data only.
 * - Teacher area: a name on the Students page opens the statistics drawer (class+subject, period,
 *   the Student overview report, latest events); axe on the drawer; "Open full report" opens the
 *   reports page with the student, the class+subject and the Student overview view preselected.
 *   Grouping: names in an arrangement open the drawer, the levels list has a statistics button.
 *   Where the name already opens something (Goals), a separate statistics button does it.
 * - Classroom: a name on a student card opens the positive-only classroom card (no statistics link,
 *   nothing teacher-only); the name and + targets do not overlap; axe on the card.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

async function seriousViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

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

test('a name in the teacher area opens the statistics drawer; Open full report preselects the student', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/teacher/classes/${ctx.classId}/students`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[3]!;

  await page.goto('/teacher/students');
  await page.getByLabel('Class', { exact: true }).selectOption({ label: '3-A' });
  const name = page.getByTestId('student-name').filter({ hasText: student.fullName }).first();
  await expect(name).toHaveAttribute('aria-haspopup', 'dialog');
  await name.click();
  const drawer = page.getByTestId('student-stats');
  await expect(drawer.getByRole('heading', { name: `${student.fullName}: statistics` })).toBeVisible();
  await expect(drawer.getByLabel('Class and subject', { exact: true }).locator('option:checked')).toContainText('3-A · English');
  await expect(drawer.getByTestId('student-stats-report').locator('section').first()).toBeVisible();
  // Names inside the drawer are plain text (it already shows this student).
  await expect(drawer.getByTestId('student-name')).toHaveCount(0);
  await drawer.getByLabel('Period', { exact: true }).selectOption({ label: 'School year' });
  await expect(drawer.getByTestId('student-stats-report')).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  expect(await seriousViolations(page, '[data-testid="student-stats"]')).toEqual([]);

  await drawer.getByRole('link', { name: 'Open full report' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/teacher\/reports\?/u);
  const url = new URL(page.url());
  expect(url.searchParams.get('studentId')).toBe(student.id);
  expect(url.searchParams.get('contextId')).toBe(ctx.id);
  expect(url.searchParams.get('view')).toBe('studentOverview');
  expect(url.searchParams.get('period')).toBe('year');
  await expect(page.getByLabel('View', { exact: true }).locator('option:checked')).toHaveText(/^Student overview/u);
  await expect(page.getByLabel('Student', { exact: true }).locator('option:checked')).toHaveText(student.fullName);
  await expect(page.getByTestId('report').getByRole('heading', { level: 2 })).toContainText(student.fullName);

  // A name in a report table opens the drawer too.
  await page.goto(`/teacher/reports?contextId=${ctx.id}&view=studentOverview`);
  const cell = page.getByTestId('report').getByTestId('student-name').first();
  const cellName = (await cell.innerText()).trim();
  await cell.click();
  await expect(page.getByTestId('student-stats').getByRole('heading', { name: `${cellName}: statistics` })).toBeVisible();
  await page.getByTestId('student-stats').getByTestId('dialog-close').click();
  await expect(page.getByTestId('student-stats')).toHaveCount(0);

  // Grouping: a name in an arrangement opens the drawer; the levels list (the name is the field's
  // label) has a separate statistics button.
  const grouping = await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/grouping`);
  if (!(grouping.body.templates as unknown[]).length) await api(page, 'POST', `/api/teacher/contexts/${ctx.id}/grouping/use-defaults`, { contextId: ctx.id });
  await page.goto('/teacher/grouping');
  const gp = page.getByTestId('grouping-page');
  await gp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
  const member = gp.getByTestId('arrangement').first().getByTestId('student-name').first();
  const memberName = (await member.innerText()).trim();
  await member.click();
  await expect(page.getByTestId('student-stats').getByRole('heading', { name: `${memberName}: statistics` })).toBeVisible();
  await expect(page.getByTestId('student-stats').getByLabel('Class and subject', { exact: true }).locator('option:checked')).toContainText('3-A · English');
  await page.getByTestId('student-stats').getByTestId('dialog-close').click();
  await expect(page.getByTestId('student-stats')).toHaveCount(0);
  await gp.getByRole('tab', { name: 'Levels' }).click();
  await gp.getByRole('button', { name: `Statistics for ${student.fullName}` }).click();
  await expect(page.getByTestId('student-stats').getByRole('heading', { name: `${student.fullName}: statistics` })).toBeVisible();
  await page.getByTestId('student-stats').getByTestId('dialog-close').click();
  await expect(page.getByTestId('student-stats')).toHaveCount(0);

  // Goals: the name opens the student's goals; statistics have their own button.
  await page.goto('/teacher/goals');
  await expect(page.getByTestId('goals-page')).toBeVisible();
  const statsButton = page.getByRole('button', { name: /^Statistics for / }).first();
  await expect(statsButton).toBeVisible();
  await statsButton.click();
  await expect(page.getByTestId('student-stats')).toBeVisible();
});

test('a name on the classroom screen opens the positive-only card, apart from the + button', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true } }] });
  expect(started.body.results[0].ok).toBe(true);
  try {
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    const card = page.locator('article.cc-student-card').first();
    await expect(card).toBeVisible();
    const nameBtn = card.getByTestId('student-card-name');
    const add = card.locator('.cc-student-card__add');
    // The two targets never overlap (grid areas apart), on every card.
    const overlaps = await page.locator('article.cc-student-card').evaluateAll((cards) =>
      cards.filter((c) => {
        const n = c.querySelector('.cc-student-card__name-btn')?.getBoundingClientRect();
        const a = c.querySelector('.cc-student-card__add')?.getBoundingClientRect();
        return n && a && n.left < a.right && a.left < n.right && n.top < a.bottom && a.top < n.bottom;
      }).length,
    );
    expect(overlaps).toBe(0);
    if (await add.count()) expect(await add.getAttribute('aria-label')).not.toBe(await nameBtn.innerText());
    const who = (await nameBtn.innerText()).trim();
    await nameBtn.click();
    const dialog = page.getByTestId('classroom-student-card');
    await expect(dialog.getByRole('heading', { name: who })).toBeVisible();
    await expect(dialog.getByText('Loading…')).toHaveCount(0);
    // No statistics and nothing teacher-only on the class's screen.
    await expect(dialog.getByRole('link')).toHaveCount(0);
    await expect(dialog.getByText(/statistics|Open full report|attendance|homework|goal/iu)).toHaveCount(0);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    expect(await seriousViolations(page, '[data-testid="classroom-student-card"]')).toEqual([]);
    await dialog.getByTestId('dialog-close').click();
    await expect(dialog).toHaveCount(0);

    // A long fictional Turkish name on the narrowest board card (compact density, 10rem), at 100% and
    // 200% text scale: the name wraps inside its own button and its text never runs under the + button.
    // (Comparing the two boxes alone cannot catch this: the text can spill out of the name's box.)
    const spill = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('[data-testid="classroom-shell"]')!;
      const art = document.querySelector<HTMLElement>('article.cc-student-card')!;
      const btn = art.querySelector<HTMLElement>('.cc-student-card__name-btn')!;
      const add = art.querySelector<HTMLElement>('.cc-student-card__add');
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode() as Text;
      const before = { density: shell.dataset.density, width: art.style.width, text: text.data, root: document.documentElement.style.fontSize };
      const problems: string[] = [];
      shell.dataset.density = 'compact';
      art.style.width = 'var(--cc-card-min)';
      text.data = 'Mustafa Çelikkayaoğulları';
      for (const scale of ['100%', '200%']) {
        document.documentElement.style.fontSize = scale;
        const range = document.createRange();
        range.selectNodeContents(btn);
        const lines = Array.from(range.getClientRects());
        const textRight = Math.max(...lines.map((r) => r.right));
        if (btn.scrollWidth > btn.clientWidth + 1) problems.push(`${scale}: name scrolls (${btn.scrollWidth} > ${btn.clientWidth})`);
        if (textRight > btn.getBoundingClientRect().right + 1) problems.push(`${scale}: text leaves the name button`);
        // Compact board cards put the + button on the line under the name (S14i review), so a line of
        // text is a problem only where it really meets the button.
        const a = add?.getBoundingClientRect();
        if (a && lines.some((r) => r.right > a.left && r.left < a.right && r.bottom > a.top && r.top < a.bottom)) problems.push(`${scale}: text runs under the + button`);
      }
      shell.dataset.density = before.density ?? '';
      art.style.width = before.width;
      text.data = before.text;
      document.documentElement.style.fontSize = before.root;
      return problems;
    });
    expect(spill).toEqual([]);
  } finally {
    await endActiveLessons(page);
  }
});
