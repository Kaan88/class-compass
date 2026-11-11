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
// Every dictionary registered, staff strings included (S23a, D-182).
import '../tests/messages.ts';
import { api, ensurePin, login, PASSWORD, PIN, studentLinkUrl } from './helpers.ts';

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
async function shot(page: Page, lang: Locale, name: string, opts: { fullPage?: boolean; clipTo?: string; from?: string; until?: string } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  // Short-lived messages (toasts) would cover the screen in a still picture.
  await page.addStyleTag({ content: '.cc-toast { visibility: hidden !important; }' });
  if (opts.from) {
    await page.locator(opts.from).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
  }
  // `until`: the picture runs from the top of the page to just below that element, so it ends at a
  // natural boundary (a whole card) instead of in the middle of one.
  const until = opts.until ? await page.locator(opts.until).boundingBox() : null;
  const width = page.viewportSize()?.width ?? 390;
  const buf = opts.clipTo
    ? await page.locator(opts.clipTo).first().screenshot({ animations: 'disabled', caret: 'hide' })
    : until
      ? await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true, clip: { x: 0, y: 0, width, height: Math.ceil(until.y + until.height + 6) } })
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

    // ---------------------------------------------------------------- sign-in page (in the browser's language before sign-in)
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: lang === 'tr' ? 'tr-TR' : 'en-GB' });
      const page = await context.newPage();
      await page.goto('/login');
      await expect(page.getByLabel(T('auth.login'))).toBeVisible();
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
    let aiToolsOn = false;

    try {
      // ---------------------------------------------------------------- teacher area
      await tp.goto('/teacher');
      await expect(tp.getByTestId('teacher-menu')).toBeVisible();
      await shot(tp, lang, 'teacher-menu');

      // S14e3 (D-156): the Class setup hub; (D-155) the notifications page.
      await tp.goto('/teacher/setup');
      await expect(tp.getByTestId('setup-hub')).toBeVisible();
      await shot(tp, lang, 'setup-hub', { from: 'main h1' });
      await tp.goto('/teacher/notifications');
      await expect(tp.getByTestId('notifications-page')).toBeVisible();
      await tp.waitForTimeout(800);
      await shot(tp, lang, 'notifications', { from: 'main h1' });

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

      // S14d (D-152): the teacher's sentence starters on the library tab.
      await tp.goto('/teacher/goals');
      await expect(tp.getByTestId('goals-page')).toBeVisible();
      await tp.getByLabel(T('teacher.chooseClass'), { exact: true }).selectOption({ label: classLabel });
      await tp.getByRole('tab', { name: T('goals.tab.library') }).click();
      await expect(tp.getByTestId('library-starters')).toBeVisible();
      await shot(tp, lang, 'goals-starters', { from: '[data-testid="library-starters"]' });

      // S14e2 (D-154): a student's name opens the statistics drawer.
      await tp.goto('/teacher/students');
      await tp.locator('main select').first().selectOption({ label: '3-A' });
      await tp.getByTestId('student-name').nth(3).click();
      const stats = tp.getByTestId('student-stats');
      await expect(stats.getByTestId('student-stats-report')).toBeVisible();
      await tp.waitForTimeout(1000);
      await shot(tp, lang, 'student-stats');
      await stats.getByTestId('dialog-close').click();

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

      // The report deep link (D-153) opens 3-A English for this month.
      await tp.goto(`/teacher/reports?contextId=${ctx3A.id}&period=month`);
      await expect(tp.getByRole('heading', { name: T('teacher.reports'), level: 1 })).toBeVisible();
      await expect(tp.getByLabel(T('report.ui.context'), { exact: true }).locator('option:checked')).toContainText(classLabel);
      await tp.waitForTimeout(800);
      await shot(tp, lang, 'reports', { from: 'main h1' });
      // S14e1 (D-153): the view bar with the Customise tree open.
      await tp.getByRole('button', { name: T('reportViews.customise'), exact: true }).click();
      await expect(tp.getByTestId('report-view-tree')).toBeVisible();
      await shot(tp, lang, 'report-views', { from: '.cc-report-viewbar' });
      await tp.getByRole('button', { name: T('reportViews.customise'), exact: true }).click();

      // ---------------------------------------------------------------- AI tools (S14h1/h2; switched on only here)
      {
        expect((await api(ap, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
        aiToolsOn = true;
        if (lang === 'en') {
          const tok = await api(tp, 'POST', '/api/account/ai-tools/tokens', { name: 'Claude Code on my laptop', scopes: ['classes:read', 'reports:read', 'goals:read'], days: 30, currentPassword: PASSWORD });
          expect(tok.status).toBe(200);
        }
        await ap.goto('/admin/ai-tools');
        await expect(ap.getByTestId('admin-ai-tools')).toBeVisible();
        await ap.waitForTimeout(600);
        await shot(ap, lang, 'ai-tools-admin', { from: 'main h1' });
        await tp.goto('/teacher/profile');
        await expect(tp.getByTestId('ai-tools')).toBeVisible();
        await shot(tp, lang, 'ai-tools-profile', { from: '[data-testid="ai-tools"]' });
        // The consent page, as Claude Code opens it (a loopback address that is never reached here).
        const callback = 'http://127.0.0.1:47123/callback';
        const reg = await tp.request.post('/oauth/register', { headers: { 'content-type': 'application/json' }, data: JSON.stringify({ client_name: 'Claude Code', redirect_uris: [callback], token_endpoint_auth_method: 'none' }) });
        expect(reg.status()).toBe(201);
        const clientId = ((await reg.json()) as { client_id: string }).client_id;
        const origin = new URL(tp.url()).origin;
        const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: callback, code_challenge: 'D'.repeat(43), code_challenge_method: 'S256', state: 'docs', resource: `${origin}/mcp`, scope: 'classes:read reports:read' });
        await tp.goto(`/oauth/authorize?${q.toString()}`);
        await expect(tp.getByTestId('oauth-consent')).toBeVisible();
        await shot(tp, lang, 'oauth-consent', { from: 'main h1' });
      }

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

      // S14e2 (D-154): a name on a card opens the small positive card.
      await tp.getByTestId('student-card-name').nth(2).click();
      const card = tp.getByTestId('classroom-student-card');
      await expect(card).toBeVisible();
      await tp.waitForTimeout(600);
      await shot(tp, lang, 'classroom-card');
      await card.getByTestId('dialog-close').click();
      await expect(card).toBeHidden();

      // S14b (D-148): Customise layout (PIN, then the editor with the timer box selected); Cancel relocks.
      await tp.getByTestId('classroom-settings').click();
      await tp.getByTestId('customise-layout').click();
      const pinDialog = tp.getByTestId('pin-dialog');
      await expect(pinDialog).toBeVisible();
      await pinDialog.locator('input').first().fill(PIN);
      await pinDialog.locator('input').first().press('Enter');
      const editor = tp.getByTestId('layout-editor');
      await expect(editor).toBeVisible();
      await tp.locator('[data-testid="layout-frame-core.timer"]').click().catch(() => undefined);
      await tp.waitForTimeout(400);
      await shot(tp, lang, 'layout-editor');
      await editor.getByRole('button', { name: T('common.cancel'), exact: true }).click();
      await expect(editor).toHaveCount(0);

      // Groups: from the board's dock (S14b) the full-screen group screen; choose an option.
      const groups = tp.getByTestId('dock-groups');
      if (await groups.count()) {
        await groups.click();
        const screen = tp.getByTestId('dock-view-groups');
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
      // S14g (D-158): the worked example theme checked and previewed (not saved).
      await ap.goto('/admin/themes');
      await expect(ap.getByRole('heading', { name: T('themes.title'), level: 1 })).toBeVisible();
      await ap.getByTestId('theme-file').setInputFiles({ name: 'ocean.theme.json', mimeType: 'application/json', buffer: fs.readFileSync(path.resolve(import.meta.dirname, '../docs/examples/ocean.theme.json')) });
      await ap.getByRole('button', { name: T('themes.import.check'), exact: true }).click();
      await expect(ap.getByTestId('theme-package-preview')).toBeVisible();
      await ap.waitForTimeout(600);
      await shot(ap, lang, 'admin-themes', { from: '[data-testid="theme-report"]' });
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
          await shot(page, lang, 'scorer-welcome', { until: '[data-testid="scorer-welcome"] > .cc-card >> nth=0' });
          await startBtn.click();
        }
        await expect(page.getByTestId('scorer-app')).toBeVisible();
        await page.getByTestId('scorer-search').fill('3a');
        await expect(page.getByTestId('scorer-results').locator('li').first()).toBeVisible();
        await shot(page, lang, 'scorer-search', { until: '[data-testid="scorer-results"] > li >> nth=1' });
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
        for (const s of withLink) {
          const g = await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/students/${s.id}/goals`);
          if (g.status === 200 && ((g.body?.goals ?? []) as Array<{ status: string }>).some((x) => x.status !== 'archived') && (g.body?.evidence?.length ?? 0) > 0) {
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
        // S14d (D-151): home tiles; "My goals" and "My avatar" are screens of their own.
        await page.getByTestId('student-tile-goals').click();
        await expect(page.getByTestId('student-goals')).toBeVisible();
        await shot(page, lang, 'student-goals', { from: '#student-screen-title' });
        await page.getByTestId('student-back').click();
        // New goal → a category → "My own words" with a sentence starter tapped.
        await page.getByTestId('student-tile-newGoal').click();
        await page.locator('.cc-student-choices .cc-student-choice').first().click();
        await page.getByRole('button', { name: T('student.newGoal.own'), exact: true }).click();
        await page.getByTestId('sentence-starters').getByRole('button').first().click();
        await page.waitForTimeout(400);
        await shot(page, lang, 'student-new-goal', { from: '#student-screen-title' });
        // How is it going? → a goal → the five faces.
        const home = new URL(page.url()).pathname;
        await page.goto(home);
        await page.getByTestId('student-tile-howIsItGoing').click();
        await page.locator('.cc-student-choices--list .cc-student-choice').first().click();
        await expect(page.getByTestId('how-face-4')).toBeVisible();
        await shot(page, lang, 'student-how', { from: '#student-screen-title' });
        // Show my work: how do you want to show it?
        await page.goto(home);
        await page.getByTestId('student-tile-showMyWork').click();
        await expect(page.getByTestId('evidence-form')).toBeVisible();
        await shot(page, lang, 'student-work', { from: '#student-screen-title' });
        await page.goto(home);
        await page.getByTestId('student-tile-avatar').click();
        await page.getByTestId('avatar-change').click();
        await expect(page.getByTestId('avatar-creator')).toBeVisible();
        await page.getByTestId('avatar-tab-make').click();
        // One phone screen from the top of the avatar panel (the whole creator was a 354×2794 strip).
        await shot(page, lang, 'student-avatar', { from: '[data-testid="student-avatar"]' });
        await phone.close();
      }
    } finally {
      // AI tools are off in the demo school; switching them off also ends the example connection (D-160).
      if (aiToolsOn) await api(ap, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false });
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
