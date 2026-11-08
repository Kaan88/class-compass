/**
 * Personal student page on a phone (S10: STU-1..7, GOL-1..5, UX-2..4). Fictional demo data only.
 * A teacher makes a link for a 3-A student and writes feedback; on a 375×812 phone the student opens
 * the link (token in the fragment, removed from the address bar), adds a preset goal, a reflection
 * with confidence and text evidence, reads the feedback and switches language (kept on the device).
 * Links are permanent (S13b2, D-115): the link is read from the class links list. After an emergency
 * revoke (D-118) the page shows "This link no longer works". axe at 375×812.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
}

async function seriousViolations(page: Page) {
  // Let short entrance animations (a toast fading in) finish, so axe measures the final colours.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('a student opens their link on a phone, adds a goal, a reflection and evidence, sees feedback; a revoked link stops working @mobile', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx3A = await context3A(page);
  const contextId = ctx3A.id;
  const setLanguage = async (mainLanguage: 'en' | 'tr', secondLanguageEnabled: boolean) =>
    expect((await api(page, 'PUT', `/api/teacher/classes/${ctx3A.classId}/language`, { mainLanguage, secondLanguageEnabled })).status).toBe(200);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${contextId}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  // One student per project: both projects run against the same demo database.
  const student = roster[test.info().project.name === 'mobile' ? 4 : 3]!;
  const url = await studentLinkUrl(page, ctx3A.classId, student.id);
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
    // Nothing on the page (the 1-5 confidence row included) makes a phone scroll sideways.
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'horizontal scroll').toBeLessThanOrEqual(0);

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

    // Text evidence (GOL-4); pictures and voice are not offered while the media flags are off (D-014).
    const evidence = english.getByTestId('evidence-form');
    await expect(evidence.getByRole('group', { name: 'What kind of evidence?' }).getByRole('button')).toHaveText(['Write', 'Add a link', 'Add a document']);
    await evidence.getByLabel('Write your evidence').fill('Book list: The Little Fox, Tom and Pip');
    await evidence.getByRole('button', { name: 'Add evidence' }).click();
    await expect(english.getByRole('region', { name: 'My evidence' }).getByRole('listitem').filter({ hasText: 'Book list: The Little Fox, Tom and Pip' })).toBeVisible();

    // Teacher feedback, read-only.
    await expect(english.getByTestId('student-feedback')).toContainText(feedback);

    // More than one subject has Goals (3-A also has Mathematics and Science): every id on the page is
    // unique, so each aria-labelledby names its own subject's heading (review fix; axe-core 4.14 no
    // longer reports duplicate ids, so this is checked directly).
    expect(await p.getByTestId('student-goals').count()).toBeGreaterThanOrEqual(2);
    // With several subjects a sticky bar jumps to each one (S13 usability); Help is in the top bar.
    const jump = p.getByRole('navigation', { name: 'Go to a subject' });
    await jump.getByRole('button', { name: 'Mathematics' }).click();
    await expect(p.getByRole('heading', { name: 'Mathematics', level: 2 })).toBeFocused();
    await expect(jump).toBeInViewport();
    await expect(p.locator('.cc-student__bar').getByRole('button', { name: 'Help', exact: true })).toBeVisible();
    const duplicateIds = await p.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(duplicateIds).toEqual([]);
    expect(await seriousViolations(p)).toEqual([]);

    // An English-only class (the default, D-099) shows no language switch.
    await expect(p.getByRole('button', { name: 'Türkçe' })).toHaveCount(0);
    // With the second language on: the switch, remembered on this device only (UX-3/4).
    await setLanguage('en', true);
    await p.reload();
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

    // An emergency revoke takes effect at once (STU-3, D-118): the open page and the old link both show the friendly page.
    expect((await api(page, 'POST', `/api/teacher/students/${student.id}/link/emergency`, { action: 'revoke', confirmName: student.fullName, reason: 'Link shared in a group chat (test)' })).status).toBe(200);
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
    await setLanguage('en', false);
  }
});

test('a busy server (429) offers "Try again" instead of "this link no longer works", and the retry opens the page @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[test.info().project.name === 'mobile' ? 6 : 5]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const p = await phone.newPage();
  try {
    let first = true;
    await p.route('**/api/student/session', async (route) => {
      if (first) {
        first = false;
        await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }) });
      } else await route.continue();
    });
    await p.goto(url);
    await expect(p.getByTestId('student-link-retry')).toBeVisible();
    await expect(p.getByTestId('student-link-gone')).toHaveCount(0);
    expect(p.url()).not.toContain('#');
    expect(await seriousViolations(p)).toEqual([]);
    await p.getByRole('button', { name: 'Try again' }).click();
    await expect(p.getByRole('heading', { name: `Hello, ${student.fullName}!` })).toBeVisible();
  } finally {
    await phone.close();
  }
});
