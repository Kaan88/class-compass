/**
 * Personal student page on a phone (S10: STU-1..7, GOL-1..5, UX-2..4; S14d: home tiles and short
 * steps, D-151; sentence starters, D-152). Fictional demo data only. At 375×812:
 * - the link opens (token in the fragment, removed from the address bar) on the home screen: hello,
 *   the subject switch (3-A has Goals in several subjects, remembered on the device), the tiles;
 * - New goal (category → ready goal → practice idea from a starter chip), How is it going? (goal →
 *   face → starter + own words), Show my work (how → which goal → words), My goals with the teacher's
 *   feedback, achievements; Back and a reload keep the screen (screens live in the query string);
 * - a link with a screen in the query and the token in the fragment opens that screen (the token is
 *   never taken for a screen);
 * - axe on every screen, in English and in Turkish; an emergency revoke (D-118) shows "This link no
 *   longer works".
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

const noSideScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const title = (p: Page) => p.locator('#student-screen-title');
const query = (p: Page) => Object.fromEntries(new URL(p.url()).searchParams);

test('a student uses the home tiles and short steps on a phone, with sentence starters, in English and Turkish; a revoked link stops working @mobile', async ({ page, browser }) => {
  test.setTimeout(240_000);
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
    await expect(p.getByRole('heading', { name: `Hello, ${student.fullName}!`, level: 1 })).toBeVisible();
    // Goals in several subjects: the subject switch; English chosen (remembered on this device).
    const subjects = p.getByRole('group', { name: 'My subject' });
    await expect(subjects.getByRole('button', { name: 'Mathematics' })).toBeVisible();
    await subjects.getByRole('button', { name: 'English', exact: true }).click();
    await expect(subjects.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const tiles = p.getByRole('navigation', { name: 'What do you want to do?' });
    for (const name of ['My goals', 'New goal', 'How is it going?', 'Show my work', 'My avatar']) await expect(tiles.getByRole('link', { name })).toBeVisible();
    expect(await noSideScroll(p), 'horizontal scroll on home').toBeLessThanOrEqual(0);
    expect(await seriousViolations(p)).toEqual([]);

    // ---- New goal: category → ready goal → a practice idea from a starter chip.
    await tiles.getByRole('link', { name: 'New goal' }).click();
    await expect(title(p)).toHaveText('New goal');
    await expect(title(p)).toBeFocused();
    expect(query(p)).toMatchObject({ screen: 'newGoal' });
    expect(await seriousViolations(p)).toEqual([]);
    await p.getByRole('button', { name: 'Reading' }).click();
    await expect(p.getByText('Step 2 of 3')).toBeVisible();
    expect(query(p)).toMatchObject({ screen: 'newGoal', step: '2' });
    await p.getByRole('button', { name: 'I will read a short book every week.' }).click();
    await expect(p.getByRole('heading', { name: 'How will you practise?' })).toBeVisible();
    await p.getByRole('button', { name: 'Read … at bedtime.' }).click();
    const idea = p.getByLabel('My idea');
    await expect(idea).toBeFocused();
    // The blank is selected: typing replaces it.
    await p.keyboard.type('comics');
    await expect(idea).toHaveValue('Read comics at bedtime.');
    await p.getByRole('button', { name: 'Add this idea' }).click();
    expect(await seriousViolations(p)).toEqual([]);
    await p.getByRole('button', { name: 'Save my goal' }).click();
    await expect(title(p)).toHaveText('My goals');
    const goal = p.getByTestId('student-goal').filter({ hasText: 'I will read a short book every week.' });
    await expect(goal).toContainText('Practice: Read comics at bedtime.');
    await expect(p.getByTestId('student-feedback')).toContainText(feedback);
    expect(await seriousViolations(p)).toEqual([]);
    // A reload keeps the screen (it is in the query string).
    await p.reload();
    await expect(title(p)).toHaveText('My goals');
    await expect(goal).toBeVisible();

    // ---- How is it going?: goal → face → a starter finished with own words.
    await p.getByTestId('student-back').click();
    await expect(p.getByRole('heading', { name: `Hello, ${student.fullName}!`, level: 1 })).toBeVisible();
    await tiles.getByRole('link', { name: 'How is it going?' }).click();
    await p.getByRole('button', { name: 'I will read a short book every week.' }).click();
    expect(query(p)).toMatchObject({ screen: 'howIsItGoing', step: '2' });
    expect(query(p).goal).toBeTruthy();
    expect(await seriousViolations(p)).toEqual([]);
    await p.getByTestId('how-face-4').click();
    await p.getByRole('button', { name: 'It is going well because …' }).click();
    // Unchanged, the starter is not saved: the hint shows when Save is pressed.
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(p.getByText('Finish your sentence', { exact: false })).toBeVisible();
    await expect(p.getByLabel('My words')).toBeFocused();
    await p.getByLabel('My words').fill('It is going well because I read every night.');
    expect(await seriousViolations(p)).toEqual([]);
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(title(p)).toHaveText('My goals');
    await expect(goal).toContainText('It is going well because I read every night.');
    await expect(goal).toContainText('Confidence 4 of 5');

    // ---- Show my work: how → which goal → words (pictures and voice stay off while the media flags are off, D-014).
    await p.getByTestId('student-back').click();
    await tiles.getByRole('link', { name: 'Show my work' }).click();
    const form = p.getByTestId('evidence-form');
    await expect(form.getByRole('group', { name: 'How do you want to show it?' }).getByRole('button')).toHaveText(['Write', 'Add a link', 'Add a document']);
    expect(await seriousViolations(p)).toEqual([]);
    await form.getByRole('button', { name: 'Write' }).click();
    await form.getByRole('button', { name: 'For all my learning' }).click();
    await form.getByRole('button', { name: 'This is my …' }).click();
    await p.keyboard.type('book list about a little fox');
    await expect(form.getByLabel('Write your evidence')).toHaveValue('This is my book list about a little fox.');
    expect(await seriousViolations(p)).toEqual([]);
    await form.getByRole('button', { name: 'Save my work' }).click();
    await expect(p.getByTestId('student-evidence').getByRole('listitem').filter({ hasText: 'This is my book list about a little fox.' })).toBeVisible();

    // ---- The phone's Back button goes back through the page's own history.
    await p.getByTestId('student-back').click();
    await tiles.getByRole('link', { name: 'My avatar' }).click();
    await expect(title(p)).toHaveText('My avatar');
    expect(await seriousViolations(p)).toEqual([]);
    await p.goBack();
    await expect(p.getByRole('heading', { name: `Hello, ${student.fullName}!`, level: 1 })).toBeFocused();

    // ---- Two subjects: Mathematics has its own tiles; the choice survives a reload.
    await subjects.getByRole('button', { name: 'Mathematics' }).click();
    await p.reload();
    await expect(p.getByRole('group', { name: 'My subject' }).getByRole('button', { name: 'Mathematics' })).toHaveAttribute('aria-pressed', 'true');
    await tiles.getByRole('link', { name: 'My goals' }).click();
    await expect(p.locator('.cc-student__nav .cc-chip')).toHaveText('Mathematics');
    await expect(p.getByTestId('student-goal').filter({ hasText: 'I will read a short book every week.' })).toHaveCount(0);
    await p.getByTestId('student-back').click();
    await subjects.getByRole('button', { name: 'English', exact: true }).click();
    // Every id on the page is unique.
    const duplicateIds = await p.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(duplicateIds).toEqual([]);
    await expect(p.locator('.cc-student__bar').getByRole('button', { name: 'Help', exact: true })).toBeVisible();

    // ---- Turkish: an English-only class shows no switch; with the second language on, the switch.
    await expect(p.getByRole('button', { name: 'Türkçe' })).toHaveCount(0);
    await setLanguage('en', true);
    await p.reload();
    await p.getByRole('button', { name: 'Türkçe' }).click();
    await expect(p.getByRole('heading', { name: `Merhaba, ${student.fullName}!` })).toBeVisible();
    await expect(p.locator('html')).toHaveAttribute('lang', 'tr');
    const trTiles = p.getByRole('navigation', { name: 'Ne yapmak istiyorsun?' });
    await expect(trTiles.getByRole('link', { name: 'Yeni hedef' })).toBeVisible();
    expect(await seriousViolations(p)).toEqual([]);
    await trTiles.getByRole('link', { name: 'Yeni hedef' }).click();
    await p.getByRole('button', { name: 'Okuma' }).click();
    await p.getByRole('button', { name: 'Kendi sözlerimle' }).click();
    await expect(p.getByRole('group', { name: 'Şöyle başla:' }).getByRole('button', { name: '… konusunda daha iyi olmak istiyorum.' })).toBeVisible();
    expect(await noSideScroll(p), 'horizontal scroll in Turkish').toBeLessThanOrEqual(0);
    expect(await seriousViolations(p)).toEqual([]);
    await p.reload();
    // After a reload the lost choices start the steps again, still in Turkish.
    await expect(p.getByText('Adım 1 / 3')).toBeVisible();
    await p.getByRole('button', { name: 'English' }).click();
    await expect(title(p)).toHaveText('New goal');

    // The teacher sees the student's work.
    const detail = await api(page, 'GET', `/api/teacher/contexts/${contextId}/students/${student.id}/goals`);
    expect(detail.body.goals.some((g: { presetText: { en?: string } | null }) => g.presetText?.en === 'I will read a short book every week.')).toBe(true);

    // ---- A screen in the query and the token in the fragment: the token is exchanged, the screen opens.
    const deep = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
    try {
      const d = await deep.newPage();
      const token = new URL(url).hash;
      await d.goto(`/s?screen=avatar${token}`);
      await expect(title(d)).toHaveText('My avatar');
      expect(d.url()).not.toContain('#');
      expect(query(d)).toEqual({ screen: 'avatar' });
      // A token put where a screen goes is just an unknown screen: home.
      await d.goto(`/s?screen=${token.slice(1)}`);
      await expect(d.getByRole('heading', { name: `Hello, ${student.fullName}!`, level: 1 })).toBeVisible();
    } finally {
      await deep.close();
    }

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
