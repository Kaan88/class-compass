/**
 * Personal student page on a phone (S10: STU-1..7, GOL-1..5, UX-2..4). Fictional demo data only.
 * A teacher makes a link for a 3-A student and writes feedback; on a 375×812 phone the student opens
 * the link (token in the fragment, removed from the address bar), adds a preset goal, a reflection
 * with confidence and text evidence, reads the feedback and switches language (kept on the device).
 * After the teacher revokes the link the page shows "This link no longer works". axe at 375×812.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
}

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('a student opens their link on a phone, adds a goal, a reflection and evidence, sees feedback; a revoked link stops working @mobile', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  const contextId = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${contextId}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  // One student per project: both projects run against the same demo database.
  const student = roster[test.info().project.name === 'mobile' ? 4 : 3]!;
  const link = await api(page, 'POST', `/api/teacher/students/${student.id}/link`);
  expect(link.status).toBe(200);
  const url = link.body.url as string;
  expect(url).toMatch(/\/s#[A-Za-z0-9_-]{43}$/u);
  const feedback = `Lovely reading this week (${Date.now()})`;
  expect((await api(page, 'POST', `/api/teacher/contexts/${contextId}/students/${student.id}/feedback`, { body: feedback })).status).toBe(200);

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const p = await phone.newPage();
  try {
    await p.goto(url);
    await expect(p.getByTestId('student-page')).toBeVisible();
    // The token never stays in the address bar or history entry (STU-4).
    expect(p.url()).not.toContain('#');
    expect(new URL(p.url()).pathname).toBe('/s');
    await expect(p.getByRole('heading', { name: `Hello, ${student.fullName}!` })).toBeVisible();

    const english = p.getByRole('region', { name: 'English', exact: true });
    // Add a preset goal (GOL-2).
    await english.getByLabel('What do you want to get better at?').selectOption({ label: 'Reading' });
    await english.getByLabel('Choose a goal').selectOption({ label: 'I will read a short book every week.' });
    await english.getByLabel('How will I practise?').fill('Library book, bedtime');
    await english.getByRole('button', { name: 'Add my goal' }).click();
    const goal = english.getByTestId('student-goal').filter({ hasText: 'I will read a short book every week.' });
    await expect(goal).toBeVisible();
    await expect(goal).toContainText('Practice: Library book, bedtime');

    // A reflection with confidence (GOL-3).
    const form = english.getByTestId('reflection-form');
    await form.getByLabel('Which goal?').selectOption({ label: 'I will read a short book every week.' });
    await form.getByLabel('My words').fill('I finished my first book!');
    await form.getByRole('button', { name: 'Confidence 4 of 5' }).click();
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    const reflections = english.getByRole('region', { name: 'My reflections' });
    await expect(reflections.getByRole('listitem').filter({ hasText: 'I finished my first book!' })).toBeVisible();
    await expect(form.getByLabel('My words')).toHaveValue('');
    await expect(reflections.getByText('Confidence 4 of 5')).toBeVisible();

    // Text evidence (GOL-4); photo and audio are not offered while the media flags are off (D-014).
    const evidence = english.getByTestId('evidence-form');
    await expect(evidence.getByLabel('What kind of evidence?').locator('option')).toHaveText(['Writing', 'Web link', 'Document']);
    await evidence.getByLabel('Write your evidence').fill('Book list: The Little Fox, Tom and Pip');
    await evidence.getByRole('button', { name: 'Add evidence' }).click();
    await expect(english.getByRole('region', { name: 'My evidence' }).getByRole('listitem').filter({ hasText: 'Book list: The Little Fox, Tom and Pip' })).toBeVisible();

    // Teacher feedback, read-only.
    await expect(english.getByTestId('student-feedback')).toContainText(feedback);

    expect(await seriousViolations(p)).toEqual([]);

    // Language switch, remembered on this device only (UX-3/4).
    await p.getByRole('button', { name: 'Türkçe' }).click();
    await expect(p.getByRole('heading', { name: `Merhaba, ${student.fullName}!` })).toBeVisible();
    await p.reload();
    await expect(p.getByRole('heading', { name: `Merhaba, ${student.fullName}!` })).toBeVisible();
    await expect(p.locator('html')).toHaveAttribute('lang', 'tr');
    await p.getByRole('button', { name: 'English' }).click();
    await expect(p.getByRole('heading', { name: `Hello, ${student.fullName}!` })).toBeVisible();

    // The teacher sees the student's work.
    const detail = await api(page, 'GET', `/api/teacher/contexts/${contextId}/students/${student.id}/goals`);
    expect(detail.body.goals.some((g: { presetText: { en?: string } | null }) => g.presetText?.en === 'I will read a short book every week.')).toBe(true);

    // Revocation takes effect at once (STU-3): the open page and the old link both show the friendly page.
    expect((await api(page, 'DELETE', `/api/teacher/students/${student.id}/link`, {})).status).toBe(200);
    await p.reload();
    await expect(p.getByTestId('student-link-gone')).toBeVisible();
    await expect(p.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
    expect(await seriousViolations(p)).toEqual([]);

    const other = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const q = await other.newPage();
      await q.goto(url);
      await expect(q.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
      expect(q.url()).not.toContain('#');
    } finally {
      await other.close();
    }
  } finally {
    await phone.close();
  }
});
