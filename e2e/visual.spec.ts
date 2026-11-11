/**
 * Visual regression baseline (S26a, D-189; ENG-3, UX-6, THM-2). Runs only with
 * playwright.visual.config.ts (npm run test:visual), never in the normal e2e suite.
 *
 * Every screen is compared with a committed picture (e2e/visual-baselines/<platform>/<project>/) at
 * the real classroom display size (1536×703 at pixel ratio 1.25, project `display`) and on a 375×812
 * phone (project `phone`): sign-in, the teacher's Today menu, the classroom board in each built-in
 * theme and in the Snow Day example package, the student page, the avatar picture editor, the admin
 * home, the Super Speakers board and a report; in English, plus one Turkish screen per area.
 *
 * Stable by construction: the server and the browser run at the same fixed moment (E2E_FIXED_NOW;
 * the server's test clock is pinned again before each screen), the demo seed has fixed ids (so the
 * generated avatars are the same), reduced motion, animations stopped, fonts loaded, and what still
 * changes (clock, timer digits, daily quote, weather) is masked. Fictional demo data only. Every
 * setting a test changes is put back in `finally`; both projects share one server.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { THEME_KEYS } from '../src/shared/themes.ts';
import { api, ensurePin, login, PIN, studentLinkUrl } from './helpers.ts';

const FIXED_NOW = Date.parse(process.env.E2E_FIXED_NOW ?? '');
const CLOCK_FILE = path.join(os.tmpdir(), `cc-e2e-clock-${process.env.E2E_PORT}`);
const SNOW = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'examples', 'peppermint-snow-day.theme.json'), 'utf8');
const SNOW_KEY = 'peppermint-snow-day';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
type Locale = 'en' | 'tr';

/** The server's test clock back at the fixed moment (it moves on with real time between screens). */
function pinServerClock() {
  fs.writeFileSync(CLOCK_FILE, String(FIXED_NOW - Date.now()));
}

test.beforeAll(() => {
  expect(Number.isFinite(FIXED_NOW), 'E2E_FIXED_NOW is set by playwright.visual.config.ts').toBe(true);
});

test.beforeEach(async ({ context }) => {
  pinServerClock();
  await context.clock.setFixedTime(FIXED_NOW);
});

/**
 * What could still differ between two runs: the weather (no network in tests, so normally hidden).
 * The clock, the date and the quote of the day (chosen from the class id and the date) are fixed by
 * the fixed moment and the fixed ids, so they are compared, not masked; mask a new element here only
 * when it cannot be made the same every run (a token, a disk size, a random picture).
 */
const masks = (page: Page): Locator[] => [page.getByTestId('weather')];

async function snap(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: masks(page), fullPage: opts.fullPage ?? false });
}

/** A second browser context with the same fixed clock (a second device: admin, phone, board). */
async function device(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Istanbul', ...opts });
  await ctx.clock.setFixedTime(FIXED_NOW);
  return { ctx, page: await ctx.newPage() };
}

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function context3A(page: Page): Promise<Ctx> {
  const all = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  return all.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
}

/** Signs in and switches the account to `lang`; returns a function that puts the account's language back. */
async function signInAs(page: Page, user: string, lang: Locale): Promise<() => Promise<void>> {
  await login(page, user);
  const before = (await api(page, 'GET', '/api/auth/me')).body.locale as Locale;
  if (before !== lang) expect((await api(page, 'PATCH', '/api/auth/preferences', { locale: lang })).status).toBe(200);
  return async () => {
    if (before !== lang) expect((await api(page, 'PATCH', '/api/auth/preferences', { locale: before })).status).toBe(200);
  };
}

/** The classroom screen locks the teacher area (PIN, D-032): unlock before changing settings back. */
async function unlock(page: Page) {
  await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN });
}

/** Class 3-A's main language (the classroom board and the student page follow it); returns the undo. */
async function class3ALanguage(page: Page, classId: string, lang: Locale): Promise<() => Promise<void>> {
  if (lang === 'en') return async () => undefined;
  expect((await api(page, 'PUT', `/api/teacher/classes/${classId}/language`, { mainLanguage: 'tr', secondLanguageEnabled: false })).status).toBe(200);
  return async () => {
    expect((await api(page, 'PUT', `/api/teacher/classes/${classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false })).status).toBe(200);
  };
}

// ------------------------------------------------------------------------------------------ sign-in
test.describe('sign-in (en)', () => {
  test('sign-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await snap(page, 'sign-in-en');
  });
});

test.describe('sign-in (tr)', () => {
  test.use({ locale: 'tr-TR' });
  test('sign-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Kullanıcı adı')).toBeVisible();
    await snap(page, 'sign-in-tr');
  });
});

// ------------------------------------------------------------------------------------------ teacher
for (const lang of ['en', 'tr'] as const) {
  test(`teacher Today menu (${lang})`, async ({ page }) => {
    const restore = await signInAs(page, 'english', lang);
    try {
      await ensurePin(page);
      await page.goto('/teacher');
      await expect(page.getByTestId('teacher-menu')).toBeVisible();
      await snap(page, `teacher-today-${lang}`);
    } finally {
      await restore();
    }
  });
}

test('report of 3-B English (en)', async ({ page }) => {
  const restore = await signInAs(page, 'english', 'en');
  try {
    await ensurePin(page);
    await page.goto('/teacher/reports');
    await page.getByLabel('Class and subject', { exact: true }).selectOption({ label: '3-B · English · 2026–2027' });
    await expect(page.getByTestId('report')).toContainText('3-B · English');
    // The whole report of a class no other screen here touches: every section and table, "not recorded" everywhere.
    await snap(page, 'report-en', { fullPage: true });
  } finally {
    await restore();
  }
});

// ------------------------------------------------------------------------------------------ classroom board
const boards: Array<{ theme: string; lang: Locale }> = [...THEME_KEYS.map((theme) => ({ theme, lang: 'en' as const })), { theme: SNOW_KEY, lang: 'en' }, { theme: 'explorer', lang: 'tr' }];

for (const { theme, lang } of boards) {
  test(`classroom board, ${theme} (${lang})`, async ({ page, browser }) => {
    const admin = await device(browser);
    let teacherRestore: () => Promise<void> = async () => undefined;
    let languageRestore: () => Promise<void> = async () => undefined;
    let ctx3a: Ctx | null = null;
    try {
      await login(admin.page, 'admin');
      if (theme === SNOW_KEY) {
        if ((await api(admin.page, 'GET', `/api/admin/themes/${SNOW_KEY}`)).status === 200) await api(admin.page, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, { confirm: SNOW_KEY });
        expect((await api(admin.page, 'POST', '/api/admin/themes', { source: SNOW })).status).toBe(200);
        expect((await api(admin.page, 'POST', `/api/admin/themes/${SNOW_KEY}/enable`)).status).toBe(200);
      }
      teacherRestore = await signInAs(page, 'english', lang);
      await ensurePin(page);
      ctx3a = await context3A(page);
      languageRestore = await class3ALanguage(page, ctx3a.classId, lang);
      expect((await api(admin.page, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme })).status).toBe(200);
      await endActiveLessons(page);
      pinServerClock();
      const started = await api(page, 'POST', '/api/commands', {
        commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx3a.id, payload: { contextId: ctx3a.id, othersPresent: true, attendance: [] } }],
      });
      expect(started.body.results[0].ok).toBe(true);
      await page.goto('/classroom');
      await page.getByRole('button', { name: /3-A · (English|İngilizce)/u }).first().click();
      await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
      await expect(page.locator('.cc-student-card').first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await snap(page, `classroom-${theme}-${lang}`);
    } finally {
      await endActiveLessons(page).catch(() => undefined);
      await unlock(page);
      await languageRestore();
      await teacherRestore();
      if (ctx3a) await api(admin.page, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme: 'explorer' }).catch(() => undefined);
      if (theme === SNOW_KEY) await api(admin.page, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, { confirm: SNOW_KEY }).catch(() => undefined);
      await admin.ctx.close();
    }
  });
}

// ------------------------------------------------------------------------------------------ student page
for (const lang of ['en', 'tr'] as const) {
  test(`student page (${lang})`, async ({ page, browser }) => {
    await login(page, 'english');
    await ensurePin(page);
    const ctx3a = await context3A(page);
    const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx3a.id}/roster`)).body.students as Array<{ id: string }>;
    const link = await studentLinkUrl(page, ctx3a.classId, roster[3]!.id);
    const restore = await class3ALanguage(page, ctx3a.classId, lang);
    const student = await device(browser, { viewport: page.viewportSize()!, hasTouch: true });
    try {
      await student.page.goto(link);
      await expect(student.page.getByTestId('student-page').or(student.page.locator('main')).first()).toBeVisible();
      await expect(student.page.locator('.cc-avatar').first()).toBeVisible();
      await snap(student.page, `student-page-${lang}`);
    } finally {
      await student.ctx.close();
      await restore();
    }
  });
}

test('avatar picture editor (en)', async ({ page, browser }) => {
  const admin = await device(browser);
  await login(admin.page, 'admin');
  await login(page, 'english');
  await ensurePin(page);
  const ctx3a = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx3a.id}/roster`)).body.students as Array<{ id: string }>;
  const link = await studentLinkUrl(page, ctx3a.classId, roster[5]!.id);
  const student = await device(browser, { viewport: page.viewportSize()!, hasTouch: true });
  try {
    expect((await api(admin.page, 'PUT', '/api/admin/module-policies/media.avatarPictures', { availability: 'enabled' })).status).toBe(200);
    expect((await api(page, 'PUT', `/api/teacher/classes/${ctx3a.classId}/avatar-settings`, { uploads: true })).status).toBe(200);
    const p = student.page;
    await p.goto(link);
    await p.getByRole('link', { name: 'My avatar' }).click();
    await p.getByTestId('avatar-picture-open').click();
    await expect(p.getByTestId('avatar-picture-screen')).toBeVisible();
    // A picture drawn by the test (a coloured square with a star; no person).
    const dataUrl = await p.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 800;
      c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = '#3a7bd5';
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#ffd34d';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 90 : 220;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        g.lineTo(400 + r * Math.cos(a), 300 + r * Math.sin(a));
      }
      g.fill();
      return c.toDataURL('image/png');
    });
    await p.getByTestId('picture-file').setInputFiles({ name: 'my-star.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') });
    await expect(p.getByTestId('picture-editor')).toBeVisible();
    await expect(p.getByTestId('picture-stage')).toBeVisible();
    await snap(p, 'avatar-picture-editor-en');
  } finally {
    await student.ctx.close();
    await api(page, 'PUT', `/api/teacher/classes/${ctx3a.classId}/avatar-settings`, { uploads: false });
    await api(admin.page, 'PUT', '/api/admin/module-policies/media.avatarPictures', { availability: 'disabled' });
    await admin.ctx.close();
  }
});

// ------------------------------------------------------------------------------------------ administration
for (const lang of ['en', 'tr'] as const) {
  test(`admin home (${lang})`, async ({ page }) => {
    const restore = await signInAs(page, 'admin', lang);
    try {
      await page.goto('/admin');
      await expect(page.getByTestId('admin-home')).toBeVisible();
      await snap(page, `admin-home-${lang}`);
    } finally {
      await restore();
    }
  });
}

// ------------------------------------------------------------------------------------------ Super Speakers board
for (const lang of ['en', 'tr'] as const) {
  test(`Super Speakers board (${lang})`, async ({ page, browser }) => {
    await login(page, 'admin');
    const policies = (await api(page, 'GET', '/api/admin/module-policies')).body.policies as Array<{ module: string; availability: string }>;
    const before = policies.find((x) => x.module === 'superSpeakers')?.availability ?? 'disabled';
    const languageBefore = ((await api(page, 'GET', '/api/admin/speakers')).body?.settings?.boardLanguage ?? 'en') as Locale;
    const created: { scorer?: string; display?: string } = {};
    const board = await device(browser, { viewport: page.viewportSize()! });
    const scorer = await device(browser);
    try {
      expect((await api(page, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: 'enabled' })).status).toBe(200);
      expect((await api(page, 'PUT', '/api/admin/speakers/settings', { boardLanguage: lang })).status).toBe(200);
      const voidAll = async (reason: string) => {
        const awards = (await api(page, 'GET', '/api/admin/speakers/awards?includeVoided=0')).body.awards as Array<{ id: string }>;
        for (const a of awards) await api(page, 'POST', `/api/admin/speakers/awards/${a.id}/void`, { reason });
      };
      await voidAll('visual baseline: clean start');
      const s = await api(page, 'POST', '/api/admin/speakers/scorers', { label: 'Visual scorer' });
      const d = await api(page, 'POST', '/api/admin/speakers/displays', { label: 'Visual hall' });
      expect(s.status).toBe(200);
      expect(d.status).toBe(200);
      created.scorer = s.body.id as string;
      created.display = d.body.id as string;
      const overview = (await api(page, 'GET', '/api/admin/speakers')).body;
      const scorerUrl = overview.scorerLinks.find((l: { id: string }) => l.id === created.scorer).url as string;
      const boardUrl = overview.displayLinks.find((l: { id: string }) => l.id === created.display).url as string;

      // Points for three pupils of 3-A, the same every run: 3, 2 and 1.
      await scorer.page.goto(scorerUrl);
      await expect(scorer.page).toHaveURL(/\/p$/u);
      const teacher = await device(browser);
      await login(teacher.page, 'english');
      const ctx3a = await context3A(teacher.page);
      const roster = (await api(teacher.page, 'GET', `/api/classroom/contexts/${ctx3a.id}/roster`)).body.students as Array<{ id: string }>;
      await teacher.ctx.close();
      for (const [i, n] of [[0, 3], [4, 2], [8, 1]] as const) {
        for (let k = 0; k < n; k++) {
          const given = await api(scorer.page, 'POST', '/api/scorer/commands', { commands: [{ opId: randomUUID(), type: 'points.award', payload: { studentId: roster[i]!.id } }] });
          expect(given.body.results[0].ok).toBe(true);
        }
      }

      await board.page.goto(boardUrl);
      await expect(board.page).toHaveURL(/\/board$/u);
      await expect(board.page.getByTestId('board-place-1')).toBeVisible();
      await snap(board.page, `speakers-board-${lang}`);
      await voidAll('visual baseline: clean end');
    } finally {
      await board.ctx.close();
      await scorer.ctx.close();
      if (created.scorer) await api(page, 'POST', `/api/admin/speakers/scorers/${created.scorer}/revoke`, { id: created.scorer });
      if (created.display) await api(page, 'POST', `/api/admin/speakers/displays/${created.display}/revoke`, { id: created.display });
      await api(page, 'PUT', '/api/admin/speakers/settings', { boardLanguage: languageBefore });
      await api(page, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: before });
    }
  });
}
