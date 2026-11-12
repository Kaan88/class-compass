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
import { expect, test, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import { translate, type Locale, type MessageKey } from '../src/shared/i18n/index.ts';
// Every dictionary registered, staff strings included (S23a, D-182).
import '../tests/messages.ts';
// The assistant chat area dictionary (S19b) is not in tests/messages.ts; importing it registers it.
import '../src/shared/i18n/areas/assistantChat.ts';
import { FAKE_KEYS, FakeProvider } from '../tests/ai-fake.ts';
import { lastToolResult, script } from '../tests/assistant-fake.ts';
import { api, ensurePin, login, openDock, PASSWORD, PIN, studentLinkUrl } from './helpers.ts';

/** The POST that "New chat" sends (its response carries the new chat's id). */
const isCreateChat = (r: Response) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/teacher/assistant-chat/chats';

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
async function shot(page: Page, lang: Locale, name: string, opts: { fullPage?: boolean; clipTo?: string; from?: string; until?: string; center?: string } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  // Short-lived messages (toasts) would cover the screen in a still picture.
  await page.addStyleTag({ content: '.cc-toast { visibility: hidden !important; }' });
  if (opts.from) {
    await page.locator(opts.from).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
  }
  // `center`: scroll this element to the middle of the window (a setting far down a long form).
  if (opts.center) {
    await page.locator(opts.center).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
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

/** A picture of the area around these elements (their union, plus `pad` pixels), within the window. */
async function shotAround(page: Page, lang: Locale, name: string, selectors: string[], pad = 16) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.addStyleTag({ content: '.cc-toast { visibility: hidden !important; }' });
  const boxes = [];
  for (const sel of selectors) {
    const b = await page.locator(sel).first().boundingBox();
    if (b) boxes.push(b);
  }
  expect(boxes.length).toBeGreaterThan(0);
  const view = page.viewportSize()!;
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(view.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(view.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  await save(lang, name, await page.screenshot({ animations: 'disabled', caret: 'hide', clip: { x, y, width: right - x, height: bottom - y } }));
}

interface Ctx {
  id: string;
  classId: string;
  className: string;
  subjectName: { en: string; tr: string };
}

/**
 * A picture drawn by the script (a coloured square with a star; no person, never a real photo), used
 * for the students' own avatar pictures (S24, D-184).
 */
async function drawPicture(p: Page) {
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
  return { name: 'my-star.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
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
    let fake: FakeProvider | null = null;
    let connectionId: string | null = null;
    let chatId: string | null = null;
    // S25c, S25d, S24: what the script switches on or changes, put back in `finally`.
    let levelsBefore: { list: string[]; levels: Array<{ studentId: string; level: string | null }> } | null = null;
    let lessonGoalsOn = false;
    let pictureStudent: string | null = null;
    let picturesOn = false;
    let notifyBefore: { categories: Record<string, boolean>; digest: unknown } | null = null;
    // S27a, S27d: the video switch and a teacher's theme draft, undone in `finally`.
    let videoOn = false;
    let draftKey: string | null = null;
    let adminChatId: string | null = null;
    let camPhone: BrowserContext | null = null;

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
      // The demo history gives goals by chance and its length follows today's date, so the first
      // student may have none: open the first one with an active goal (the "Active" column).
      const goalRows = tp.getByTestId('goals-page').locator('table tbody tr');
      await expect(goalRows.first()).toBeVisible();
      const activeCounts = await goalRows.evaluateAll((rows) => rows.map((r) => Number(r.querySelectorAll('td, th')[1]?.textContent?.trim() ?? '0')));
      const withGoal = activeCounts.findIndex((n) => n > 0);
      expect(withGoal).toBeGreaterThanOrEqual(0);
      await goalRows.nth(withGoal).getByRole('button').first().click();
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

      // S25c (D-187): Grouping → Levels with a level list (the guide's example words); the demo school has
      // no levels, so the list and the levels are set here and put back in `finally`.
      {
        const overview = (await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/grouping`)).body as { levelList: string[]; students: Array<{ id: string; level: string | null }> };
        levelsBefore = { list: overview.levelList, levels: overview.students.map((s) => ({ studentId: s.id, level: s.level })) };
        const words = lang === 'tr' ? ['Başlıyor', 'Gelişiyor', 'Güçlü', 'Yıldız'] : ['Starter', 'Growing', 'Strong', 'Star'];
        expect((await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/grouping/level-list`, { contextId: ctx3A.id, labels: words })).status).toBe(200);
        const levels = overview.students.map((s, i) => ({ studentId: s.id, level: words[(i * 7) % words.length]! }));
        expect((await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/levels`, { contextId: ctx3A.id, levels })).status).toBe(200);
        await tp.goto('/teacher/grouping');
        const gp = tp.getByTestId('grouping-page');
        await gp.getByLabel(T('teacher.chooseClass'), { exact: true }).selectOption({ label: classLabel });
        await gp.getByRole('tab', { name: T('grouping.tab.levels') }).click();
        await expect(gp.getByTestId('level-list-saved').locator('li')).toHaveText(words);
        await tp.setViewportSize({ width: 1280, height: 1250 });
        await tp.waitForTimeout(300);
        await shot(tp, lang, 'grouping-levels', { from: 'main h1' });
        await tp.setViewportSize({ width: 1280, height: 900 });
      }

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
        // The page starts with Assistant connections (S19a/b); this picture shows the AI apps part.
        await shot(ap, lang, 'ai-tools-admin', { from: '[data-testid="ai-checklist"]' });
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

      // ---------------------------------------------------------------- Assistant connections and the Assistant page (S19a/b)
      // A scripted local model on 127.0.0.1 (tests/assistant-fake.ts), never a real provider; removed in `finally`.
      {
        fake = new FakeProvider();
        const base = `${await fake.start()}/v1`;
        const name = lang === 'tr' ? 'Okulun modeli' : 'School model';
        const conn = await api(ap, 'POST', '/api/admin/ai-connections', { type: 'openaiCompatible', name, baseUrl: base, localNetwork: true, models: ['school-model'], apiKey: FAKE_KEYS.compatible, kvkkConfirmed: true });
        expect(conn.status).toBe(200);
        connectionId = conn.body.id as string;
        expect((await api(ap, 'PUT', '/api/admin/ai-connection-settings', { defaultConnectionId: connectionId, defaultModel: 'school-model' })).status).toBe(200);
        expect((await api(ap, 'PUT', '/api/admin/assistant-chat', { enabled: true })).status).toBe(200);
        await ap.goto('/admin/ai-tools');
        await expect(ap.getByTestId('ai-connections')).toContainText(name);
        await expect(ap.getByTestId('assistant-chat-admin').getByRole('switch')).toBeChecked();
        // Test the model (two tiny requests without school data, answered by the fake), as an administrator would.
        await ap.getByTestId('ai-connections').getByRole('button', { name: /school-model/u }).click();
        await expect(ap.getByTestId('ai-conn-test-result')).toBeVisible();
        await ap.waitForTimeout(400);
        await shot(ap, lang, 'ai-connections', { from: '[data-testid="ai-connections"]' });

        const text =
          lang === 'tr'
            ? { ask: 'Bu hafta hangi ödevlerin teslimi var?', look: 'Sınıflarınıza bakıyorum.', answer: (n: number) => `${n} sınıfınız var. Bu hafta teslimi olan ödev yok.`, answerRe: /^\d+ sınıfınız var\. Bu hafta teslimi olan ödev yok\.$/u, set: '3-A için okuma ödevi ver: 3. bölümü oku.', hw: 'Okuma: 3. bölüm' }
            : { ask: 'Which homework is due this week in my classes?', look: 'Let me look at your classes.', answer: (n: number) => `You teach ${n} classes. Nothing is due this week.`, answerRe: /^You teach \d+ classes\. Nothing is due this week\.$/u, set: 'Set reading homework for 3-A: read chapter 3.', hw: 'Reading: chapter 3' };
        script(fake, [
          (body) => {
            const last = body.messages.at(-1);
            if (last.role === 'user' && last.content.includes(text.ask)) return { text: text.look, calls: [{ name: 'list_my_classes', args: {} }] };
            if (last.role === 'tool' && Array.isArray(lastToolResult(body)?.contexts)) return { text: text.answer(lastToolResult(body).contexts.length) };
            return { calls: [{ name: 'create_homework', args: { contextId: ctx3A.id, title: text.hw, dueOn: '2026-11-20' } }] };
          },
        ]);
        await tp.goto('/teacher/ai-assistant');
        // The id comes from the create response, so `finally` deletes the chat even if a later step fails.
        const teacherCreated = tp.waitForResponse(isCreateChat);
        await tp.getByTestId('assistant-new-chat').click();
        chatId = ((await (await teacherCreated).json()) as { id: string }).id;
        await expect(tp.getByTestId('assistant-suggestions')).toBeVisible();
        const composer = tp.getByLabel(T('assistantChat.composer' as MessageKey));
        await composer.fill(text.ask);
        await tp.getByTestId('assistant-send').click();
        await expect(tp.getByTestId('assistant-messages').getByText(text.answerRe)).toBeVisible();
        await expect(tp.getByTestId('assistant-activity').first()).toBeVisible();
        await expect(tp.getByTestId('assistant-stop')).toBeHidden();
        await composer.fill(text.set);
        await tp.getByTestId('assistant-send').click();
        // The change waits on its card; it is never confirmed here (the chat is deleted in `finally`).
        await expect(tp.getByTestId('assistant-change-card').last()).toHaveAttribute('data-state', 'pending');
        // A taller window, so the whole waiting card is in the picture.
        await tp.setViewportSize({ width: 1280, height: 1250 });
        await tp.waitForTimeout(400);
        await shot(tp, lang, 'assistant', { from: 'main h1' });
        await tp.setViewportSize({ width: 1280, height: 900 });

        // S27d (D-196): Admin → Assistant with a formatted (Markdown) answer. The question needs no school
        // data; the scripted answer only restates the steps the admin guide gives.
        const how =
          lang === 'tr'
            ? {
                ask: 'Bir öğretmenin tema taslağını nasıl açarım?',
                answer:
                  '## Bir tema taslağını açmak\n\nTaslak hiçbir sınıfa kendiliğinden verilmez. Siz karar verirsiniz:\n\n1. **Temalar** sayfasını açın.\n2. Taslağın yanındaki **Önizle** ile renklere ve seslere bakın.\n3. Gerekirse öneren öğretmenle konuşun.\n4. **Aç** ya da **Sil**\'e basın.\n\n| Kim | Ne yapabilir |\n|---|---|\n| Öğretmen | Taslak önerir (en çok 5) |\n| Yönetici | Önizler, açar, siler |\n\n*Bunu ben yapamam:* bir temayı açmak her zaman sizin adımınızdır.',
              }
            : {
                ask: 'How do I enable a teacher’s theme draft?',
                answer:
                  '## Enabling a theme draft\n\nA draft is never given to a class by itself. You decide:\n\n1. Open **Themes**.\n2. Press **Preview** next to the draft and look at the colours and sounds.\n3. Talk to the teacher who proposed it, if needed.\n4. Choose **Enable** or **Delete**.\n\n| Who | What they can do |\n|---|---|\n| Teacher | Proposes a draft (up to 5) |\n| Administrator | Previews, enables, deletes |\n\n*I cannot do this for you:* enabling a theme is always your step.',
              };
        script(fake, [() => ({ text: how.answer })]);
        await ap.goto('/admin/ai-assistant');
        const adminCreated = ap.waitForResponse(isCreateChat);
        await ap.getByTestId('assistant-new-chat').click();
        adminChatId = ((await (await adminCreated).json()) as { id: string }).id;
        await ap.waitForURL(/[?&]chat=/u);
        await ap.getByLabel(T('assistantChat.composer' as MessageKey)).fill(how.ask);
        await ap.getByTestId('assistant-send').click();
        const adminAnswer = ap.getByTestId('assistant-message-assistant').last();
        await expect(adminAnswer.getByRole('table')).toBeVisible();
        await expect(ap.getByTestId('assistant-stop')).toBeHidden();
        await ap.setViewportSize({ width: 1280, height: 1100 });
        await ap.waitForTimeout(400);
        await shot(ap, lang, 'admin-assistant', { from: 'main h1' });
        await ap.setViewportSize({ width: 1280, height: 900 });
      }

      await tp.goto('/teacher/import');
      await expect(tp.getByRole('heading', { name: T('import.title'), level: 1 })).toBeVisible();
      await shot(tp, lang, 'import', { from: 'main h1' });

      // ---------------------------------------------------------------- classroom (enters classroom mode)
      // S25d (D-188): Lesson goals is off in every class until the teacher switches it on; on only here.
      expect((await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/modules/lessonGoals`, { enabled: true })).status).toBe(200);
      lessonGoalsOn = true;
      const goalText = lang === 'tr' ? 'Hava durumu hakkında soru sorup cevap verebiliriz.' : 'We can ask and answer about the weather.';
      await tp.goto('/classroom');
      // The switcher names subjects in the active class's language, which may be either.
      await tp.getByRole('button', { name: /^3-A · (English|İngilizce)/u }).click();
      await expect(tp.getByTestId('no-lesson')).toBeVisible();
      await tp.getByRole('button', { name: T('lesson.start') }).click();
      const start = tp.getByTestId('start-lesson');
      await expect(start).toBeVisible();
      await shot(tp, lang, 'start-lesson');
      // The "Today's goal" step with the goal typed in.
      const goalStep = start.getByTestId('lesson-goal-step');
      for (let i = 0; i < 6 && !(await goalStep.isVisible()); i++) await start.getByRole('button', { name: T('common.next'), exact: true }).click();
      await goalStep.locator('textarea, input[type="text"]').first().fill(goalText);
      await shot(tp, lang, 'start-lesson-goal');
      for (let i = 0; i < 6 && (await start.getByRole('button', { name: T('lesson.begin') }).count()) === 0; i++) {
        await start.getByRole('button', { name: T('common.next'), exact: true }).click();
      }
      await start.getByRole('button', { name: T('lesson.begin') }).click();
      const dashboard = tp.getByTestId('lesson-dashboard');
      await expect(dashboard).toBeVisible();
      await tp.getByRole('button', { name: T('routine.next') }).click().catch(() => undefined);
      await tp.waitForTimeout(1000);
      await shot(tp, lang, 'classroom');
      // The board box "Today's goal" beside today's focus (the top of the board down to the box).
      await expect(tp.getByTestId('lesson-goal')).toContainText(goalText);
      await shotAround(tp, lang, 'classroom-goal', ['.cc-lesson-row:has([data-box="lessonGoal"])']);

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
        // The options arrive with the grouping query: wait for them (a count() before they load skipped the
        // tap, and the picture and the award dialog then had no groups).
        const option = screen.getByTestId('group-options').getByRole('button').first();
        await expect(option).toBeVisible();
        // A tap while the screen is still opening can be lost: tap again until the groups are shown.
        const cards = screen.getByTestId('group-card').first();
        for (let i = 0; i < 3 && !(await cards.isVisible()); i++) {
          await option.click();
          await cards.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
        }
        await expect(cards).toBeVisible();
        await tp.waitForTimeout(800);
        await shot(tp, lang, 'group-screen');
        await tp.keyboard.press('Escape');
        await expect(screen).toBeHidden();

        // S25a (D-185): the award dialog ticks a group of this lesson in one tap (nothing is given here).
        // The groups reach the dialog through the polled lesson state: wait until the server has them.
        await expect
          .poll(async () => ((await api(tp, 'GET', `/api/classroom/contexts/${ctx3A.id}/lesson`)).body?.grouping?.groups ?? []).length, { timeout: 30_000 })
          .toBeGreaterThan(0);
        const view = await openDock(tp, 'achievements');
        await view.getByTestId('achievements-give').click();
        const dialog = tp.getByTestId('achievements-dialog');
        await expect(dialog.getByTestId('achievements-groups')).toBeVisible({ timeout: 30_000 });
        await dialog.getByTestId('achievements-group').first().click();
        await expect(dialog.getByTestId('achievements-group').first()).toHaveAttribute('aria-pressed', 'true');
        // The tap scrolls the dialog's list; the picture starts at the dialog's title.
        await dialog.evaluate((el) => {
          for (const n of [el, ...el.querySelectorAll('*')]) if (n.scrollTop) n.scrollTop = 0;
        });
        await tp.waitForTimeout(400);
        await shot(tp, lang, 'award-dialog', { clipTo: '[data-testid="achievements-dialog"]' });
        await tp.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        if (await view.isVisible()) await tp.keyboard.press('Escape');
        await expect(view).toBeHidden();
      }

      await tp.getByRole('button', { name: T('lesson.end'), exact: true }).click();
      await expect(tp.getByTestId('end-lesson')).toBeVisible();
      await tp.waitForTimeout(500);
      await shot(tp, lang, 'end-lesson');
      // "Did we reach our goal?" with an answer chosen (the lesson is not saved here).
      const review = tp.getByTestId('lesson-goal-review');
      await expect(review).toContainText(goalText);
      await review.getByRole('radio', { name: T('lessonGoals.outcome.reached') }).click();
      await tp.locator('[data-testid="lesson-goal-review"]').scrollIntoViewIfNeeded();
      await shotAround(tp, lang, 'end-lesson-goal', ['[data-testid="end-lesson"] section:has([data-testid="lesson-goal-review"])'], 24);
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

      // S28a (D-197): a second lesson with the default routine (the demo history gives 3-A a routine of
      // its own without a "Learning goal" stage) and today's goal: the goal on that stage, then the
      // lesson saved with the class's answer and the "Lesson saved" summary.
      const cmd3A = async (type: string, payload: Record<string, unknown>) => {
        const r = await api(tp, 'POST', '/api/commands', {
          commands: [{ opId: randomUUID(), type, contextId: ctx3A.id, ...(payload.lessonId ? { lessonId: payload.lessonId } : {}), payload: { contextId: ctx3A.id, ...payload } }],
        });
        expect(r.body.results[0].ok, type).toBe(true);
        return r.body.results[0].result as { lessonId: string };
      };
      const { lessonId: goalLessonId } = await cmd3A('lesson.start', { routineTemplateId: 'builtin:default', othersPresent: true });
      await cmd3A('lessonGoals.set', { lessonId: goalLessonId, text: goalText });
      const goalLesson = (await api(tp, 'GET', `/api/classroom/contexts/${ctx3A.id}/lesson`)).body;
      const goalStageIndex = (goalLesson.lesson.routine.stages as Array<{ id: string }>).findIndex((st) => st.id === 'learning-goal');
      expect(goalStageIndex).toBeGreaterThanOrEqual(0);
      await tp.goto('/classroom');
      if (!(await dashboard.isVisible())) await tp.getByRole('button', { name: /^3-A · (English|İngilizce)/u }).click();
      await expect(dashboard).toBeVisible();
      await tp.getByTestId('routine-stages').getByRole('button').nth(goalStageIndex).click();
      await expect(tp.getByTestId('stage-goal')).toContainText(goalText);
      await tp.waitForTimeout(800);
      await shotAround(tp, lang, 'routine-goal', ['[data-box="routine"]']);
      await tp.getByRole('button', { name: T('lesson.end'), exact: true }).click();
      await expect(tp.getByTestId('end-lesson')).toBeVisible();
      await tp.getByTestId('lesson-goal-review').getByRole('radio', { name: T('lessonGoals.outcome.reached') }).click();
      await tp.getByRole('button', { name: T('lesson.saveAndEnd') }).click();
      const summary = tp.getByTestId('lesson-summary');
      await expect(summary.getByTestId('summary-goal')).toContainText(goalText);
      await expect(summary.getByTestId('summary-goal')).toContainText(T('lessonGoals.outcome.reached'));
      await tp.waitForTimeout(500);
      await shot(tp, lang, 'lesson-summary-goal', { clipTo: '[data-testid="lesson-summary"]' });
      // Back to the teacher area (the PIN again), as the rest of the script expects.
      await tp.getByRole('button', { name: T('classroom.teacherArea') }).click();
      await expect(tp.getByText(T('pin.enter')).first()).toBeVisible();
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
      // S25b (D-186): the holiday calendar of the demo year (the demo history adds the fixed-date holidays).
      await ap.goto('/admin/holidays');
      await expect(ap.getByRole('heading', { name: T('admin.holidays'), level: 1 })).toBeVisible();
      await expect(ap.locator('main table tbody tr').first()).toBeVisible();
      await ap.setViewportSize({ width: 1280, height: 1100 });
      await ap.waitForTimeout(300);
      await shot(ap, lang, 'admin-holidays', { from: 'main h1' });
      await ap.setViewportSize({ width: 1280, height: 900 });
      // S14g (D-158): the worked example theme checked and previewed (not saved).
      await ap.goto('/admin/themes');
      await expect(ap.getByRole('heading', { name: T('themes.title'), level: 1 })).toBeVisible();
      await ap.getByTestId('theme-file').setInputFiles({ name: 'ocean.theme.json', mimeType: 'application/json', buffer: fs.readFileSync(path.resolve(import.meta.dirname, '../docs/examples/ocean.theme.json')) });
      await ap.getByRole('button', { name: T('themes.import.check'), exact: true }).click();
      await expect(ap.getByTestId('theme-package-preview')).toBeVisible();
      await ap.waitForTimeout(600);
      await shot(ap, lang, 'admin-themes', { from: '[data-testid="theme-report"]' });
      // S27d (D-196): a teacher's theme draft ("Proposed by"), proposed through the teacher's normal
      // endpoint with a fictional package made from the worked example; deleted in `finally`.
      {
        const ocean = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../docs/examples/ocean.theme.json'), 'utf8')) as Record<string, unknown>;
        const key = 'autumn-leaves-draft';
        const proposed = await api(tp, 'POST', '/api/teacher/themes/drafts', { source: JSON.stringify({ ...ocean, key, name: { en: 'Autumn Leaves', tr: 'Sonbahar Yaprakları' } }) });
        expect(proposed.status).toBe(200);
        draftKey = key;
        await ap.goto('/admin/themes');
        await expect(ap.getByTestId(`theme-proposed-${key}`)).toBeVisible();
        await shot(ap, lang, 'admin-theme-draft', { clipTo: 'section[aria-labelledby="custom-themes-title"]' });
      }
      await ap.goto('/admin/super-speakers');
      await expect(ap.getByTestId('speakers-admin')).toBeVisible();
      await shot(ap, lang, 'speakers-admin', { from: 'main h1' });
      // S24 (D-184): the board settings with "Show students' own pictures on the board and the scorer" (off).
      await expect(ap.getByText(T('speakers.showOwnPictures'), { exact: true })).toBeVisible();
      await shot(ap, lang, 'speakers-pictures', { center: `text=${JSON.stringify(T('speakers.showOwnPictures'))}` });
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
        // S27b (D-194): "Add my work" on a goal, and the steps it opens (for that goal, no goal step).
        const addWork = page.locator('[data-add-work-for]').first();
        await expect(addWork).toBeVisible();
        await shot(page, lang, 'student-goal-add', { center: '[data-add-work-for]' });
        await addWork.click();
        const goalForm = page.getByTestId('evidence-form');
        await expect(goalForm).toHaveAttribute('data-step', 'how');
        await expect(goalForm.getByTestId('evidence-for-goal')).toBeVisible();
        await shot(page, lang, 'student-goal-add-work', { from: '#student-screen-title' });
        await page.goto(new URL(page.url()).pathname);
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

        // S24 (D-184): students' own avatar pictures. The school switch and the class switch are on only
        // here; the picture is a drawing made by the script; everything is removed in `finally`.
        expect((await api(ap, 'PUT', '/api/admin/module-policies/media.avatarPictures', { availability: 'enabled' })).status).toBe(200);
        picturesOn = true;
        expect((await api(tp, 'PUT', `/api/teacher/classes/${ctx3A.classId}/avatar-settings`, { uploads: true })).status).toBe(200);
        pictureStudent = chosen;
        // No "sent a picture" notification for the teacher: it would outlive the deleted picture and show
        // up in the next language's notifications picture.
        const ns = (await api(tp, 'GET', '/api/teacher/notification-settings')).body as { categories: Record<string, boolean>; digest: unknown };
        notifyBefore = { categories: ns.categories, digest: ns.digest };
        expect((await api(tp, 'PUT', '/api/teacher/notification-settings', { categories: { ...ns.categories, avatarPicture: false }, digest: ns.digest })).status).toBe(200);
        await page.goto(home);
        await page.getByTestId('student-tile-avatar').click();
        await page.getByTestId('avatar-picture-open').click();
        const pictureScreen = page.getByTestId('avatar-picture-screen');
        await expect(pictureScreen).toBeVisible();
        // A little taller than the phone, so "Choose a picture" is in the picture too.
        await page.setViewportSize({ width: 390, height: 980 });
        await shot(page, lang, 'student-own-picture', { from: '#student-screen-title' });
        await page.setViewportSize({ width: 390, height: 844 });
        await pictureScreen.getByTestId('picture-file').setInputFiles(await drawPicture(page));
        const pictureEditor = page.getByTestId('picture-editor');
        await expect(pictureEditor).toBeVisible();
        await pictureEditor.getByTestId('picture-zoom').fill('130');
        await page.waitForTimeout(300);
        await shot(page, lang, 'student-picture-editor', { from: '[data-testid="picture-editor"]' });
        const sent = page.waitForResponse((r) => r.url().endsWith('/api/student/avatar-picture') && r.request().method() === 'POST');
        await pictureEditor.getByTestId('picture-send').click();
        expect((await sent).status()).toBe(200);
        await expect(page.getByTestId('picture-waiting')).toBeVisible();
        await shot(page, lang, 'student-picture-waiting', { from: '#student-screen-title' });
        await phone.close();

        // The teacher's "Avatar pictures" page with the picture to check (the confirmation ticked, not
        // approved), in a fresh session: this one went through the classroom and shows its banner.
        {
          // A short window, so the heading can be scrolled to the top of this short page.
          const office = await signedIn(browser, 'english', lang, { width: 1280, height: 680 });
          await office.page.goto('/teacher/avatar-pictures');
          const review = office.page.getByTestId('avatar-pictures-page');
          await expect(review).toBeVisible();
          const toCheck = review.getByTestId('picture-to-check').first();
          await expect(toCheck).toBeVisible();
          await toCheck.getByTestId('picture-confirm').check();
          await office.page.waitForTimeout(300);
          await shot(office.page, lang, 'avatar-pictures', { from: 'main h1' });
          await office.context.close();
        }

        // Admin → Modules and media → Photos and media: the switch and the school-wide list.
        await ap.goto('/admin/modules');
        await ap.getByRole('tab', { name: T('modules.tab.media') }).click();
        await expect(ap.getByTestId('admin-avatar-pictures')).toBeVisible();
        await ap.setViewportSize({ width: 1280, height: 1700 });
        await ap.waitForTimeout(500);
        await shot(ap, lang, 'admin-media', { from: 'main h1' });
        await ap.setViewportSize({ width: 1280, height: 900 });

        // S27a (D-193): "Record a video" and "Add a video" on Show my work, and the in-page recorder with
        // Chromium's fake camera (a test pattern). The school switch is on only here (off in `finally`);
        // nothing is recorded to the server: the clip is never used.
        expect((await api(ap, 'PUT', '/api/admin/module-policies/media.evidenceVideo', { availability: 'enabled' })).status).toBe(200);
        videoOn = true;
        {
          // Closed in `finally` too, so a failed step does not leave the fake camera open.
          camPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, permissions: ['camera', 'microphone'] });
          await camPhone.addInitScript((l) => localStorage.setItem('cc.studentLocale', l), lang);
          const vp = await camPhone.newPage();
          await vp.goto(url);
          await expect(vp.getByTestId('student-page')).toBeVisible();
          await vp.getByTestId('student-tile-showMyWork').click();
          const form = vp.getByTestId('evidence-form');
          await expect(form).toHaveAttribute('data-step', 'how');
          const record = form.getByRole('button', { name: T('evidence.mode.video'), exact: true });
          await expect(record).toBeVisible();
          await expect(form.getByRole('button', { name: T('evidence.mode.videoFile'), exact: true })).toBeVisible();
          // Tall enough for every choice, the video ones included.
          await vp.setViewportSize({ width: 390, height: 1300 });
          await shot(vp, lang, 'student-video', { until: '[data-testid="evidence-form"]' });
          await vp.setViewportSize({ width: 390, height: 844 });
          await record.click();
          if ((await form.getAttribute('data-step')) === 'goal') await form.getByRole('button', { name: T('student.work.all'), exact: true }).click();
          const recorder = form.getByTestId('video-recorder');
          const startRec = recorder.getByRole('button', { name: T('evidence.video.start'), exact: true });
          await expect(startRec).toBeEnabled();
          await startRec.click();
          await expect(recorder.getByTestId('video-timer')).toBeVisible();
          await vp.waitForTimeout(2300);
          await shot(vp, lang, 'student-video-recorder', { from: '#student-screen-title' });
          await recorder.getByRole('button', { name: T('student.audio.stop'), exact: true }).click();
          await expect(recorder).toHaveAttribute('data-phase', 'recorded');
          await camPhone.close();
          camPhone = null;
        }
      }
    } finally {
      await camPhone?.close();
      // AI tools are off in the demo school; switching them off also ends the example connection (D-160).
      if (chatId) await api(tp, 'DELETE', `/api/teacher/assistant-chat/chats/${chatId}`);
      if (adminChatId) await api(ap, 'DELETE', `/api/teacher/assistant-chat/chats/${adminChatId}`);
      if (draftKey) await api(ap, 'DELETE', `/api/admin/themes/${draftKey}`, { confirm: draftKey });
      if (videoOn) await api(ap, 'PUT', '/api/admin/module-policies/media.evidenceVideo', { availability: 'disabled' });
      if (connectionId) {
        await api(ap, 'PUT', '/api/admin/assistant-chat', { enabled: false });
        await api(ap, 'PUT', '/api/admin/ai-connection-settings', { defaultConnectionId: null, defaultModel: null });
        await api(ap, 'DELETE', `/api/admin/ai-connections/${connectionId}`);
      }
      await fake?.close();
      if (aiToolsOn) await api(ap, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false });
      // The teacher endpoints below need the teacher area unlocked (the classroom part locks it).
      await api(tp, 'POST', '/api/auth/pin/unlock', { pin: PIN });
      if (pictureStudent) {
        const list = (await api(ap, 'GET', '/api/admin/avatar-pictures')).body as { toCheck: Array<{ id: string; studentId: string }>; inUse: Array<{ id: string; studentId: string }> } | null;
        for (const x of [...(list?.toCheck ?? []), ...(list?.inUse ?? [])].filter((x) => x.studentId === pictureStudent)) await api(ap, 'DELETE', `/api/admin/avatar-pictures/${x.id}`, {});
      }
      if (notifyBefore) await api(tp, 'PUT', '/api/teacher/notification-settings', notifyBefore);
      if (picturesOn) {
        await api(tp, 'PUT', `/api/teacher/classes/${ctx3A.classId}/avatar-settings`, { uploads: false });
        await api(ap, 'PUT', '/api/admin/module-policies/media.avatarPictures', { availability: 'disabled' });
      }
      if (lessonGoalsOn) {
        await endActiveLessons(tp);
        await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/modules/lessonGoals`, { enabled: false });
      }
      if (levelsBefore) {
        await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/grouping/level-list`, { contextId: ctx3A.id, labels: levelsBefore.list });
        await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/levels`, { contextId: ctx3A.id, levels: levelsBefore.levels });
      }
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
