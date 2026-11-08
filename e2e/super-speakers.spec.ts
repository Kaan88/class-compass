/**
 * Super Speakers end to end (S12, SSP-1..8): the administrator switches the module on and creates a
 * scorer link and a board link on Admin → Super Speakers; a scorer on a phone (Pixel 7 viewport)
 * opens the link, searches "isik" (finds "Işık"), gives +1 and undoes it; the board on a 1920×1080
 * screen updates live (Server-Sent Events) without a reload, fits without scrolling at 1920×1080 and
 * 1280×720, and shows the placeholder after the weekly reset (server test clock moved past Monday
 * 00:00, NODE_ENV=test only). A second test feeds the board a synthetic school (50 classes, 40 students
 * tied for first place) and checks that every name is shown and no class row overlaps another at
 * 1920×1080 and 1280×720 (S12 review). Fictional demo data only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { api, login } from './helpers.ts';

const clockFile = path.join(os.tmpdir(), `cc-e2e-clock-${process.env.E2E_PORT}`);
const setServerClockOffset = (ms: number) => fs.writeFileSync(clockFile, String(ms));

/** Milliseconds from now until a minute after the next Monday 00:00 in Istanbul (UTC+3, no DST). */
function untilNextWeek(): number {
  const now = Date.now();
  const local = new Date(now + 3 * 3600_000);
  const daysToMonday = ((8 - local.getUTCDay()) % 7) || 7;
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysToMonday);
  return mondayLocal - 3 * 3600_000 + 60_000 - now;
}

/** Starts the week clean: every live point of this week is removed by the administrator (audited). */
async function clearThisWeek(page: Page) {
  const awards = (await api(page, 'GET', '/api/admin/speakers/awards?includeVoided=0')).body.awards as Array<{ id: string }>;
  for (const a of awards) expect((await api(page, 'POST', `/api/admin/speakers/awards/${a.id}/void`, { reason: 'e2e clean start' })).status).toBe(200);
}

async function fitsWithoutScrolling(page: Page) {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test('admin creates links; a phone scorer finds "isik", gives +1 and undoes; the board updates live and resets weekly', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  await login(page, 'admin');
  expect((await api(page, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: 'enabled' })).status).toBe(200);
  await clearThisWeek(page);

  // Admin page: create a scorer link and a board link.
  await page.goto('/admin/super-speakers');
  await expect(page.getByTestId('speakers-admin')).toBeVisible();
  await page.getByRole('tab', { name: 'Links' }).click();
  await page.getByTestId('create-scorer').getByLabel('Name shown in the log').fill(`Ms Deniz ${stamp}`);
  await page.getByTestId('create-scorer').getByRole('button', { name: 'Create scorer link' }).click();
  await expect(page.getByTestId('scorer-link-row').filter({ hasText: `Ms Deniz ${stamp}` })).toBeVisible();
  await page.getByTestId('create-board').getByLabel('Where is this screen?').fill(`Hall ${stamp}`);
  await page.getByTestId('create-board').getByRole('button', { name: 'Create board link' }).click();
  await expect(page.getByTestId('board-link-row').filter({ hasText: `Hall ${stamp}` })).toBeVisible();
  const overview = (await api(page, 'GET', '/api/admin/speakers')).body;
  const scorerUrl = overview.scorerLinks.find((l: { label: string }) => l.label === `Ms Deniz ${stamp}`).url as string;
  const boardUrl = overview.displayLinks.find((l: { label: string }) => l.label === `Hall ${stamp}`).url as string;
  expect(scorerUrl).toMatch(/\/p#[A-Za-z0-9_-]{43}$/u);
  expect(boardUrl).toMatch(/\/board#[A-Za-z0-9_-]{43}$/u);
  // A fictional pupil called Işık in 4-C (deactivated again at the end, so other tests' rosters stay as seeded).
  const c4c = overview.classes.find((c: { name: string }) => c.name === '4-C').id as string;
  const isik = await api(page, 'POST', '/api/admin/students', { classId: c4c, fullName: `Işık Konuşkan ${stamp}` });
  expect(isik.status).toBe(200);

  // The board on a 1920×1080 screen (its own browser context, like a separate device).
  const screenCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const board = await screenCtx.newPage();
  await board.goto(boardUrl);
  await expect(board).toHaveURL(/\/board$/u);
  await expect(board.getByTestId('board-placeholder')).toHaveText(/We are waiting for our super speakers/u);
  await expect(board.getByTestId('board-classes')).toContainText('3-A');
  expect(await fitsWithoutScrolling(board)).toBe(true);

  // The scorer on a phone.
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  await phone.goto(scorerUrl);
  await expect(phone).toHaveURL(/\/p$/u);
  await expect(phone.getByTestId('scorer-welcome')).toBeVisible();
  await expect(phone.getByTestId('scorer-install')).toBeVisible();
  // The install sections show a chevron, so a closed one reads as something to open (usability audit).
  for (const summary of await phone.getByTestId('scorer-install').locator('summary').all()) {
    expect(await summary.evaluate((el) => getComputedStyle(el, '::before').content)).not.toBe('none');
  }
  await phone.getByTestId('scorer-start').click();
  // A few class buttons wrap instead of running off the right edge.
  const chips = phone.locator('.cc-scorer__chips');
  await expect(chips).toHaveAttribute('data-wrap', 'yes');
  expect(await chips.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await phone.getByTestId('scorer-search').fill('isik');
  const first = phone.getByTestId('scorer-results').getByTestId('scorer-student').first();
  await expect(first).toContainText(/Işık/u);
  const name = (await first.locator('.cc-scorer__name').innerText()).trim();
  await first.getByRole('button', { name: `Give ${name} one point` }).click();
  await expect(phone.getByTestId('scorer-undo-bar')).toContainText(`+1 for ${name}`);
  // "Undo" stays on one line next to the message.
  expect(await textLines(phone.getByTestId('scorer-undo'))).toBe(1);

  // Live on the board within a few seconds, without a reload.
  await expect(board.getByTestId('board-place-1')).toContainText(name, { timeout: 5_000 });
  await expect(board.getByTestId('board-place-1')).toContainText('1 point');
  expect(await fitsWithoutScrolling(board)).toBe(true);

  // Undo on the phone: the board goes back to the placeholder.
  await phone.getByTestId('scorer-undo').click();
  await expect(board.getByTestId('board-placeholder')).toBeVisible({ timeout: 5_000 });
  await expect(phone.getByTestId('scorer-today')).toContainText('Undone');

  // A real point again (after the double-tap guard), then the board at 1280×720 still fits.
  await phone.waitForTimeout(800);
  await first.getByRole('button', { name: `Give ${name} one point` }).click();
  await expect(board.getByTestId('board-place-1')).toContainText(name, { timeout: 5_000 });
  await expect(phone.getByTestId('scorer-app').locator('.cc-save')).toContainText('Saved', { timeout: 5_000 });
  await board.setViewportSize({ width: 1280, height: 720 });
  expect(await fitsWithoutScrolling(board)).toBe(true);
  await board.setViewportSize({ width: 1920, height: 1080 });

  // Weekly reset: the server clock moves past next Monday 00:00 (Istanbul); the board notices on its own.
  try {
    setServerClockOffset(untilNextWeek());
    await expect(board.getByTestId('board-placeholder')).toBeVisible({ timeout: 10_000 });
    await expect(board.getByTestId('board-classes')).toContainText('3-A');
  } finally {
    setServerClockOffset(0);
  }
  // Back in this week the point is still there (the reset is only a time window).
  await expect(board.getByTestId('board-place-1')).toContainText(name, { timeout: 10_000 });

  await clearThisWeek(page);
  expect((await api(page, 'POST', `/api/admin/students/${isik.body.id}/deactivate`)).status).toBe(200);
  await phoneCtx.close();
  await screenCtx.close();
});

/** How many lines the text of an element takes. */
async function textLines(locator: Locator) {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.bottom))).size;
  });
}

/** A synthetic board of a 1,500-student school (S12 review): 50 classes and a crowded first place. */
function crowdedBoard() {
  const given = ['Ayşe', 'Çınar', 'Işıl', 'İpek', 'Ömer', 'Şule', 'Ufuk', 'Gül', 'Deniz', 'Ece', 'Arda', 'Zeynep', 'Kerem', 'Nehir', 'Yağmur', 'Barış'];
  const family = ['Yıldız', 'Kurgu', 'Örnek', 'Çiçekdağı', 'Şimşekoğlu', 'Akdeniz', 'Gökyüzü', 'Işıkpınar'];
  const pupil = (i: number, cls: string) => ({ id: `0190f0f0-0000-7000-8000-${String(i).padStart(12, '0')}`, fullName: `${given[i % given.length]} ${given[(i * 7 + 3) % given.length]} ${family[i % family.length]}`, initials: 'AB', avatarHue: (i * 37) % 360, avatar: null, className: cls });
  const classes = Array.from({ length: 50 }, (_, i) => ({ classId: `c${i}`, name: `${(i % 4) + 1}-${String.fromCharCode(65 + Math.floor(i / 4))}`, points: 50 - i }));
  return {
    enabled: true,
    title: { en: 'Super Speakers' },
    messages: { placeholder: {}, waiting: {} },
    language: 'en',
    theme: 'explorer',
    sound: false,
    week: { start: '2026-11-09', end: '2026-11-15' },
    timezone: 'Europe/Istanbul',
    places: [
      { rank: 1, points: 3, students: Array.from({ length: 40 }, (_, i) => pupil(i, classes[i]!.name)) },
      { rank: 2, points: 2, students: Array.from({ length: 5 }, (_, i) => pupil(100 + i, '2-B')) },
      { rank: 3, points: 1, students: [pupil(200, '4-C')] },
    ],
    classes,
    updatedAt: Date.UTC(2026, 10, 9, 9, 0, 0),
    version: 'synthetic-crowded',
  };
}

/** Every tied name and every class row is inside its box: nothing clipped, no rows on top of each other. */
async function boardLayoutProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    for (const ul of document.querySelectorAll<HTMLElement>('.cc-board__names')) {
      if (ul.scrollHeight > ul.clientHeight + 1 || ul.scrollWidth > ul.clientWidth + 1) problems.push(`names of ${ul.dataset.count} overflow`);
    }
    const rows = [...document.querySelectorAll<HTMLElement>('.cc-board__bar-row')];
    rows.forEach((r) => {
      if (r.scrollHeight > r.clientHeight + 1) problems.push(`class row ${r.textContent} is taller than its slot`);
    });
    const rects = rows.map((r) => r.getBoundingClientRect());
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 1 && overlapY > 1) problems.push(`class rows ${i} and ${j} overlap`);
      }
    const smallest = Math.min(...[...document.querySelectorAll<HTMLElement>('.cc-board__name, .cc-board__bar-name')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
    return { problems, smallest, names: document.querySelectorAll('.cc-board__student').length, rows: rows.length };
  });
}

test('the board shows every tied student and 50 class totals without overlap at 1920×1080 and 1280×720 (S12 review)', async ({ page, browser }) => {
  await login(page, 'admin');
  const link = await api(page, 'POST', '/api/admin/speakers/displays', { label: `Crowded hall ${Date.now().toString(36)}` });
  expect(link.status).toBe(200);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const board = await ctx.newPage();
  const data = crowdedBoard();
  await board.route('**/api/board', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await board.goto(link.body.url as string);
  await expect(board.getByTestId('board-place-1')).toContainText(data.places[0]!.students[39]!.fullName);
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    await board.setViewportSize(size);
    await board.waitForTimeout(300);
    expect(await fitsWithoutScrolling(board)).toBe(true);
    const r = await boardLayoutProblems(board);
    expect(r.problems).toEqual([]);
    expect(r.names).toBe(46);
    expect(r.rows).toBe(50);
    // Small, but still text (about 7 px at 720p is the floor of the fitting loop for 40 names).
    expect(r.smallest).toBeGreaterThanOrEqual(6);
  }
  await expect(board.getByText(/more/u)).toHaveCount(0);
  expect((await api(page, 'POST', `/api/admin/speakers/displays/${link.body.id}/revoke`)).status).toBe(200);
  await ctx.close();
});

test('two students sharing a place keep big names and avatars on the board (usability audit)', async ({ page, browser }) => {
  await login(page, 'admin');
  const link = await api(page, 'POST', '/api/admin/speakers/displays', { label: `Tie screen ${Date.now().toString(36)}` });
  expect(link.status).toBe(200);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const board = await ctx.newPage();
  const data = crowdedBoard();
  const [crowd, five, one] = data.places as [(typeof data.places)[number], (typeof data.places)[number], (typeof data.places)[number]];
  // 1st: one student; 2nd: two tied; 3rd: five tied.
  data.places = [
    { rank: 1, points: 3, students: one.students },
    { rank: 2, points: 2, students: five.students.slice(0, 2) },
    { rank: 3, points: 1, students: crowd.students.slice(0, 5) },
  ];
  data.classes = data.classes.slice(0, 6);
  await board.route('**/api/board', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await board.goto(link.body.url as string);
  const second = board.getByTestId('board-place-2');
  await expect(second).toHaveAttribute('data-density', 'few');
  await expect(board.getByTestId('board-place-3')).toHaveAttribute('data-density', 'many');
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await board.setViewportSize(size);
    await board.waitForTimeout(300);
    expect(await fitsWithoutScrolling(board)).toBe(true);
    expect((await boardLayoutProblems(board)).problems).toEqual([]);
    // Names of a two-way tie are at least 3 % of the screen height (about 22 px at 720p), not 2.3 %.
    const nameSize = await second.locator('.cc-board__name').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(nameSize).toBeGreaterThanOrEqual(size.height * 0.03);
  }
  expect((await api(page, 'POST', `/api/admin/speakers/displays/${link.body.id}/revoke`)).status).toBe(200);
  await ctx.close();
});
