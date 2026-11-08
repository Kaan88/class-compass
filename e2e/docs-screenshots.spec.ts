/**
 * Screenshots for the user guides (docs/guides/img/{en,tr}). NOT a test of the normal suite: it runs
 * only with `npx playwright test -c playwright.docs.config.ts` (npm run docs:screenshots), against a
 * throw-away server with the fictional demo school and `seed:demo-history` (E2E_DEMO_HISTORY=1).
 *
 * Every screenshot is re-encoded as a palette PNG with sharp to keep the repository small. Fictional
 * data only: no real names, links or tokens appear (link addresses are shown only as QR codes of a
 * throw-away server, which stops existing after the run).
 *
 * Language: the teacher and administrator accounts are switched to the guide's language, class 3-A
 * is shown in English (en) or Turkish with English as second language (tr), and the scorer, student
 * page and board use the same language. Everything is put back at the end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { translate, type Locale, type MessageKey } from '../src/shared/i18n/index.ts';
import { api, ensurePin, login, PIN, studentLinkUrl } from './helpers.ts';

const IMG_ROOT = path.resolve(import.meta.dirname, '../docs/guides/img');

async function save(lang: Locale, name: string, png: Buffer) {
  const dir = path.join(IMG_ROOT, lang);
  fs.mkdirSync(dir, { recursive: true });
  const out = await sharp(png).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(dir, `${name}.png`), out);
}

/**
 * `from`: scroll this element to the top first (teacher and admin pages: the page heading, so the
 * menu bar does not fill the picture). `clipTo`: photograph only this element.
 */
async function shot(page: Page, lang: Locale, name: string, opts: { fullPage?: boolean; clipTo?: string; from?: string } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  // Short-lived messages (toasts) would cover the screen in a still picture.
  await page.addStyleTag({ content: '.cc-toast { visibility: hidden !important; }' });
  if (opts.from) {
    await page.locator(opts.from).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
  }
  const buf = opts.clipTo
    ? await page.locator(opts.clipTo).first().screenshot({ animations: 'disabled', caret: 'hide' })
    : await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: opts.fullPage ?? false });
  await save(lang, name, buf);
}

interface Ctx {
  id: string;
  classId: string;
  className: string;
  subjectName: { en: string; tr: string };
}

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function signedIn(browser: Browser, user: string, lang: Locale, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, locale: lang === 'tr' ? 'tr-TR' : 'en-GB', timezoneId: 'Europe/Istanbul' });
  const page = await context.newPage();
  await login(page, user);
  expect((await api(page, 'PATCH', '/api/auth/preferences', { locale: lang })).status).toBe(200);
  return { context, page };
}

for (const lang of ['en', 'tr'] as const) {
  test(`guide screenshots (${lang})`, async ({ browser }) => {
    const T = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
    const subject = (c: Ctx) => (lang === 'tr' ? c.subjectName.tr : c.subjectName.en);

    // ---------------------------------------------------------------- sign-in page (always English before sign-in)
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto('/login');
      await expect(page.getByLabel('Username')).toBeVisible();
      await shot(page, lang, 'sign-in');
      await context.close();
    }

    const admin = await signedIn(browser, 'admin', lang);
    const teacher = await signedIn(browser, 'english', lang);
    const tp = teacher.page;
    const ap = admin.page;
    await ensurePin(tp);
    await endActiveLessons(tp);
    const contexts = (await api(tp, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
    const ctx3A = contexts.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
    const classLabel = `${ctx3A.className} · ${subject(ctx3A)}`;
    const classLang = lang === 'tr' ? { mainLanguage: 'tr', secondLanguageEnabled: true } : { mainLanguage: 'en', secondLanguageEnabled: false };
    expect((await api(tp, 'PUT', `/api/teacher/classes/${ctx3A.classId}/language`, classLang)).status).toBe(200);
    expect((await api(ap, 'PUT', '/api/admin/speakers/settings', { boardLanguage: lang })).status).toBe(200);

    try {
      // ---------------------------------------------------------------- teacher area
      await tp.goto('/teacher');
      await expect(tp.getByTestId('teacher-menu')).toBeVisible();
      await shot(tp, lang, 'teacher-menu');

      await tp.goto('/teacher/profile');
      await expect(tp.getByTestId('profile-page')).toBeVisible();
      await shot(tp, lang, 'profile-pin', { from: 'main h1' });

      await tp.goto('/teacher/classes');
      await tp.getByLabel(T('teacher.chooseClass'), { exact: true }).first().selectOption({ label: classLabel }).catch(() => undefined);
      await expect(tp.getByRole('heading', { name: T('teacher.classSettings'), level: 1 })).toBeVisible();
      await shot(tp, lang, 'class-settings', { from: 'main h1' });

      await tp.goto('/teacher/student-links');
      const links = tp.getByTestId('links-page');
      await expect(links).toBeVisible();
      await links.getByLabel(T('links.chooseClass'), { exact: true }).selectOption({ label: '3-A' });
      await expect(links.getByTestId('link-row').first()).toBeVisible();
      await shot(tp, lang, 'student-links', { from: '[data-testid="links-page"] h1' });

      await tp.goto('/teacher/goals');
      await expect(tp.getByTestId('goals-page')).toBeVisible();
      await tp.getByLabel(T('teacher.chooseClass'), { exact: true }).selectOption({ label: classLabel });
      await tp.getByTestId('goals-page').locator('table button').first().click();
      await expect(tp.getByTestId('teacher-student-goals')).toBeVisible();
      await expect(tp.getByTestId('teacher-goal').first()).toBeVisible();
      await shot(tp, lang, 'goals-student', { from: '[data-testid="teacher-student-goals"]' });

      await tp.goto('/teacher/homework');
      await expect(tp.getByTestId('homework-page')).toBeVisible();
      await tp.getByLabel(T('teacher.chooseClass'), { exact: true }).selectOption({ label: classLabel });
      for (let i = 0; i < 4 && (await tp.getByTestId('homework-item').count()) === 0; i++) {
        await tp.getByRole('button', { name: T('homework.previous'), exact: true }).click();
        await tp.waitForTimeout(300);
      }
      const item = tp.getByTestId('homework-item').first();
      await item.getByRole('button').first().click();
      await expect(tp.getByTestId('homework-check')).toBeVisible();
      await shot(tp, lang, 'homework-check', { from: '[data-testid="homework-item"]' });

      await tp.goto('/teacher/achievements');
      await expect(tp.getByRole('heading', { name: T('teacher.achievements'), level: 1 })).toBeVisible();
      await tp.getByLabel(T('teacher.chooseClass'), { exact: true }).first().selectOption({ label: classLabel }).catch(() => undefined);
      await shot(tp, lang, 'achievements', { from: 'main h1' });

      await tp.goto('/teacher/avatars');
      await expect(tp.getByRole('heading', { name: T('teacher.avatars'), level: 1 })).toBeVisible();
      await shot(tp, lang, 'avatars', { from: 'main h1' });

      await tp.goto('/teacher/reports');
      await expect(tp.getByRole('heading', { name: T('teacher.reports'), level: 1 })).toBeVisible();
      await tp.getByLabel(T('report.ui.context'), { exact: true }).selectOption({ label: classLabel }).catch(() => undefined);
      await tp.getByLabel(T('report.ui.period'), { exact: true }).selectOption({ label: T('report.preset.month') }).catch(() => undefined);
      await tp.waitForTimeout(800);
      await shot(tp, lang, 'reports', { from: 'main h1' });

      await tp.goto('/teacher/import');
      await expect(tp.getByRole('heading', { name: T('import.title'), level: 1 })).toBeVisible();
      await shot(tp, lang, 'import', { from: 'main h1' });

      // ---------------------------------------------------------------- classroom (enters classroom mode)
      await tp.goto('/classroom');
      // The switcher names subjects in the active class's language, which may be either.
      await tp.getByRole('button', { name: /^3-A · (English|İngilizce)/u }).click();
      await expect(tp.getByTestId('no-lesson')).toBeVisible();
      await tp.getByRole('button', { name: T('lesson.start') }).click();
      const start = tp.getByTestId('start-lesson');
      await expect(start).toBeVisible();
      await shot(tp, lang, 'start-lesson');
      for (let i = 0; i < 6 && (await start.getByRole('button', { name: T('lesson.begin') }).count()) === 0; i++) {
        await start.getByRole('button', { name: T('common.next'), exact: true }).click();
      }
      await start.getByRole('button', { name: T('lesson.begin') }).click();
      const dashboard = tp.getByTestId('lesson-dashboard');
      await expect(dashboard).toBeVisible();
      await tp.getByRole('button', { name: T('routine.next') }).click().catch(() => undefined);
      await tp.waitForTimeout(1000);
      await shot(tp, lang, 'classroom');

      // Groups: choose an option, then the full-screen group screen.
      const groups = tp.getByTestId('groups-panel');
      if (await groups.count()) {
        await groups.getByRole('button').first().click();
        const screen = tp.getByTestId('group-screen');
        await expect(screen).toBeVisible();
        const option = screen.getByTestId('group-options').getByRole('button').first();
        if (await option.count()) await option.click();
        await tp.waitForTimeout(800);
        await shot(tp, lang, 'group-screen');
        await tp.keyboard.press('Escape');
        await expect(screen).toBeHidden();
      }

      await tp.getByRole('button', { name: T('lesson.end'), exact: true }).click();
      await expect(tp.getByTestId('end-lesson')).toBeVisible();
      await tp.waitForTimeout(500);
      await shot(tp, lang, 'end-lesson');
      await tp.getByRole('button', { name: T('lesson.backToLesson') }).click();
      await expect(dashboard).toBeVisible();

      // The teacher area is locked in classroom mode: the PIN screen.
      await tp.getByRole('button', { name: T('classroom.teacherArea') }).click();
      await expect(tp.getByText(T('pin.enter')).first()).toBeVisible();
      await shot(tp, lang, 'pin-lock');
      for (const d of PIN) await tp.getByRole('button', { name: d, exact: true }).click();
      await tp.getByRole('button', { name: T('pin.unlock') }).click().catch(() => undefined);
      await expect(tp.getByTestId('teacher-menu')).toBeVisible();
      await endActiveLessons(tp);

      // ---------------------------------------------------------------- administration
      await ap.goto('/admin');
      await expect(ap.getByTestId('admin-home')).toBeVisible();
      await shot(ap, lang, 'admin-home');
      await ap.goto('/admin/users');
      await expect(ap.getByRole('heading', { name: T('admin.users'), level: 1 })).toBeVisible();
      await shot(ap, lang, 'admin-accounts', { from: 'main h1' });
      await ap.goto('/admin/settings');
      await expect(ap.getByRole('heading', { name: T('admin.settings'), level: 1 })).toBeVisible();
      await shot(ap, lang, 'admin-settings', { from: 'main h1' });
      await ap.goto('/admin/modules');
      await expect(ap.getByRole('heading', { name: T('admin.modules'), level: 1 })).toBeVisible();
      await shot(ap, lang, 'admin-modules', { from: 'main h1' });
      await ap.goto('/admin/students');
      await expect(ap.getByRole('heading', { name: T('admin.students'), level: 1 })).toBeVisible();
      await ap.waitForTimeout(500);
      await shot(ap, lang, 'admin-students', { from: 'main h1' });
      await ap.goto('/admin/maintenance');
      await expect(ap.getByRole('heading', { name: T('admin.maintenance'), level: 1 })).toBeVisible();
      await shot(ap, lang, 'admin-maintenance', { from: 'main h1' });
      await ap.goto('/admin/super-speakers');
      await expect(ap.getByTestId('speakers-admin')).toBeVisible();
      await shot(ap, lang, 'speakers-admin', { from: 'main h1' });
      await ap.getByRole('tab', { name: T('speakers.admin.links') }).click();
      await expect(ap.getByTestId('scorer-link-row').first()).toBeVisible();
      await shot(ap, lang, 'speakers-links', { from: '[data-testid="scorer-link-row"]' });

      // ---------------------------------------------------------------- Super Speakers: scorer phone and board
      const overview = (await api(ap, 'GET', '/api/admin/speakers')).body as { scorerLinks: Array<{ url: string | null }>; displayLinks: Array<{ url: string | null }> };
      const scorerUrl = overview.scorerLinks.find((l) => l.url)!.url!;
      const boardUrl = overview.displayLinks.find((l) => l.url)!.url!;
      {
        const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
        await phone.addInitScript((l) => localStorage.setItem('cc.scorerLocale', l), lang);
        const page = await phone.newPage();
        await page.goto(scorerUrl);
        const startBtn = page.getByTestId('scorer-start');
        await expect(startBtn.or(page.getByTestId('scorer-app'))).toBeVisible();
        if (await startBtn.isVisible()) {
          await shot(page, lang, 'scorer-welcome');
          await startBtn.click();
        }
        await expect(page.getByTestId('scorer-app')).toBeVisible();
        await page.getByTestId('scorer-search').fill('3a');
        await expect(page.getByTestId('scorer-results').locator('li').first()).toBeVisible();
        await shot(page, lang, 'scorer-search');
        await phone.close();
      }
      {
        const screen = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        const page = await screen.newPage();
        await page.goto(boardUrl);
        await page.waitForTimeout(2500);
        await shot(page, lang, 'board');
        await screen.close();
      }

      // ---------------------------------------------------------------- student page on a phone
      {
        const students = (await api(tp, 'GET', `/api/teacher/classes/${ctx3A.classId}/student-links`)).body.students as Array<{ id: string; link: { url: string | null } | null }>;
        const withLink = students.filter((s) => s.link?.url);
        // A student with goals and an avatar from the demo history makes the clearest picture.
        let chosen = withLink[0]!.id;
        for (const s of withLink.slice(0, 8)) {
          const g = await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/students/${s.id}/goals`);
          if (g.status === 200 && (g.body?.goals?.length ?? 0) > 0 && (g.body?.evidence?.length ?? 0) > 0) {
            chosen = s.id;
            break;
          }
        }
        const url = await studentLinkUrl(tp, ctx3A.classId, chosen);
        const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
        await phone.addInitScript((l) => localStorage.setItem('cc.studentLocale', l), lang);
        const page = await phone.newPage();
        await page.goto(url);
        await expect(page.getByTestId('student-page')).toBeVisible();
        await page.waitForTimeout(800);
        await shot(page, lang, 'student-page');
        await shot(page, lang, 'student-goals', { from: 'h2.cc-student__subject' });
        await page.getByTestId('avatar-change').click();
        await expect(page.getByTestId('avatar-creator')).toBeVisible();
        await page.getByTestId('avatar-tab-make').click();
        await page.getByTestId('student-avatar').scrollIntoViewIfNeeded();
        await shot(page, lang, 'student-avatar', { clipTo: '[data-testid="student-avatar"]' });
        await phone.close();
      }
    } finally {
      await api(tp, 'POST', '/api/auth/pin/unlock', { pin: PIN });
      await api(tp, 'PUT', `/api/teacher/classes/${ctx3A.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false });
      await api(ap, 'PUT', '/api/admin/speakers/settings', { boardLanguage: 'en' });
      await api(tp, 'PATCH', '/api/auth/preferences', { locale: 'en' });
      await api(ap, 'PATCH', '/api/auth/preferences', { locale: 'en' });
      await teacher.context.close();
      await admin.context.close();
    }
  });
}
