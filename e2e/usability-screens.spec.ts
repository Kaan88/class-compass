/**
 * Usability screenshot crawler. NOT a test of the normal suite: it runs only with
 * `npm run usability:screens` (playwright.usability.config.ts) against a throw-away server with the
 * fictional demo school and `seed:demo-history`. Output: usability-shots/<label>/ (git-ignored),
 * one full-page PNG per page, state, viewport, language and theme:
 *
 *   <area>__<page>__<state>__<viewport>__<lang>__<theme>.png
 *
 * Areas: auth, help (signed-out pages, guides, not found, catalogue), teacher, classroom, admin,
 * student, superSpeakers. The route lists come from the client router and the module manifests
 * (parsed from the source), so a new page that no scene captures is reported in `_missed.txt`
 * instead of being skipped silently. A step that fails is logged there too and the crawl goes on:
 * this is a picture set for a usability review, not a pass/fail test.
 *
 * Everything the crawl changes in the demo school (languages, themes, media flags, the homework
 * setting, the board settings) is put back at the end of each test. Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { dictionaries, type Locale } from '../src/shared/i18n/index.ts';
import { DEFAULT_THEME, THEME_KEYS } from '../src/shared/themes.ts';
import { api, ensurePin, login, PASSWORD, PIN, studentLinkUrl } from './helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const LABEL = process.env.USABILITY_LABEL ?? 'before';
const OUT = path.join(ROOT, 'usability-shots', LABEL);
const MISSED = path.join(OUT, '_missed.txt');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- devices

interface Device {
  name: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
}
const DEV = {
  phone: { name: 'phone-375x812', width: 375, height: 812, scale: 2, mobile: true },
  tablet: { name: 'tablet-768x1024', width: 768, height: 1024, scale: 1, mobile: false },
  laptop: { name: 'laptop-1366x768', width: 1366, height: 768, scale: 1, mobile: false },
  desktop: { name: 'desktop-1920x1080', width: 1920, height: 1080, scale: 1, mobile: false },
  display720: { name: 'display-1280x720', width: 1280, height: 720, scale: 1, mobile: false },
  // A 3840x2160 panel at 200% operating-system scaling: 1920x1080 CSS pixels, 3840x2160 image.
  display4k: { name: 'display-3840x2160', width: 1920, height: 1080, scale: 2, mobile: false },
} as const satisfies Record<string, Device>;

/** Pages of an office computer or phone (teacher area, administration, guides). */
const OFFICE_RUNS: Array<[Device, Locale]> = [
  [DEV.phone, 'en'],
  [DEV.tablet, 'en'],
  [DEV.laptop, 'en'],
  [DEV.desktop, 'en'],
  [DEV.desktop, 'tr'],
  [DEV.phone, 'tr'],
];

async function newPage(browser: Browser, dev: Device, lang: Locale, extra: Parameters<Browser['newContext']>[0] = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.scale,
    isMobile: dev.mobile,
    hasTouch: true,
    locale: lang === 'tr' ? 'tr-TR' : 'en-GB',
    timezoneId: 'Europe/Istanbul',
    ...extra,
  });
  return { context, page: await context.newPage() };
}

// ---------------------------------------------------------------- texts in either language

const EN = dictionaries.en as Record<string, string>;
const TR = dictionaries.tr as Record<string, string>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** Exact accessible name in English or Turkish (every key whose English text is `en`). */
function nm(en: string, exact = true): RegExp {
  const alts = new Set([en]);
  for (const [k, v] of Object.entries(EN)) if (v === en && TR[k]) alts.add(TR[k]);
  const body = [...alts].map(esc).join('|');
  return new RegExp(exact ? `^(${body})$` : `(${body})`, 'u');
}
/** The message key of a visible text (either language), for language-neutral file names. */
function keyOf(text: string): string | null {
  const t = text.trim();
  for (const dict of [EN, TR]) for (const [k, v] of Object.entries(dict)) if (v === t) return k;
  return null;
}

// ---------------------------------------------------------------- shots and the missed log

type Area = 'auth' | 'help' | 'teacher' | 'classroom' | 'admin' | 'student' | 'superSpeakers';

function slug(s: string): string {
  const out = s
    .toLocaleLowerCase('en')
    .replace(/ı/gu, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return out || 'x';
}

function miss(what: string, e?: unknown) {
  const raw = e instanceof Error ? (e.message.split('\n')[0] ?? '') : e === undefined ? '' : String(e);
  // Playwright colours its messages; the log is plain text.
  const msg = raw.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu'), '');
  fs.appendFileSync(MISSED, `${what}${msg ? `: ${msg}` : ''}\n`);
  console.warn(`[usability] missed ${what} ${msg}`);
}

/** Runs one capture step; a failure is logged and the crawl goes on. */
async function step(what: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    miss(what, e);
  }
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(300);
}

interface ShotSpec {
  area: Area;
  page: string;
  state: string;
  dev: Device;
  lang: Locale;
  /** Default: the theme the page shows (`<html data-theme>`). */
  theme?: string;
  /** Overlays that animate in (celebrations) are photographed while they play. */
  animations?: 'allow' | 'disabled';
}

async function shot(page: Page, s: ShotSpec) {
  await settle(page);
  const theme = s.theme ?? ((await page.evaluate(() => document.documentElement.dataset.theme ?? '').catch(() => '')) || 'default');
  const file = `${[s.area, ...[s.page, s.state, s.dev.name, s.lang, theme].map(slug)].join('__')}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: s.animations ?? 'disabled', caret: 'hide', timeout: 90_000 });
}

// ---------------------------------------------------------------- routes from the source

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ROUTER = read('src/client/router.tsx');
/** Top-level paths of the client router (`/login`, `/classroom`, …). */
const ROOT_PATHS = [...ROUTER.matchAll(/getParentRoute: \(\) => rootRoute,\s*path: '([^']+)'/gu)].map((m) => m[1]!);
/** `/admin/<path>` pages of the router. */
const ADMIN_PATHS = [...ROUTER.matchAll(/getParentRoute: \(\) => adminRoute,\s*path: '([^']+)'/gu)].map((m) => m[1]!).map((p) => (p === '/' ? '' : p));
/** `/teacher/<path>` pages of the client module manifests (`teacherPages`, the only `path:` entries there). */
const TEACHER_PATHS = fs
  .readdirSync(path.join(ROOT, 'src/client/modules'))
  .filter((d) => fs.existsSync(path.join(ROOT, 'src/client/modules', d, 'manifest.tsx')))
  .flatMap((d) => [...read(`src/client/modules/${d}/manifest.tsx`).matchAll(/(?<![a-zA-Z])path: '([a-z0-9-]+)'/gu)].map((m) => m[1]!));
const GUIDES = fs.readdirSync(path.join(ROOT, 'docs/guides/en')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
const covered = new Set<string>();
const cover = (route: string) => covered.add(route);

// ---------------------------------------------------------------- demo school helpers

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

async function contextOf(page: Page, className: string): Promise<Ctx> {
  const contexts = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  return contexts.find((c) => c.className === className && c.subjectName.en === 'English')!;
}

async function signIn(browser: Browser, user: string, dev: Device = DEV.laptop, lang: Locale = 'en') {
  const s = await newPage(browser, dev, lang);
  await login(s.page, user);
  return s;
}

const setLocale = async (page: Page, locale: Locale) => expect((await api(page, 'PATCH', '/api/auth/preferences', { locale })).status).toBe(200);
const setClassLanguage = async (page: Page, classId: string, body: Record<string, unknown>) => expect((await api(page, 'PUT', `/api/teacher/classes/${classId}/language`, body)).status).toBe(200);
const setClassTheme = async (admin: Page, classId: string, theme: string) => expect((await api(admin, 'PATCH', `/api/admin/classes/${classId}`, { theme })).status).toBe(200);
async function classTheme(admin: Page, classId: string): Promise<string> {
  const classes = (await api(admin, 'GET', '/api/admin/classes')).body.classes as Array<{ id: string; theme: string }>;
  return classes.find((c) => c.id === classId)!.theme;
}
const OTHER_THEMES = THEME_KEYS.filter((k) => k !== DEFAULT_THEME);

/** Selects class 3-A (or "3-A · English") in every class chooser on the page. */
async function chooseClass(page: Page, cls = '3-A') {
  const selects = page.locator('main select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const sel = selects.nth(i);
    if (!(await sel.isVisible().catch(() => false))) continue;
    const opts = (await sel.locator('option').allInnerTexts()).map((o) => o.trim());
    // The report and statistics choosers add the school year ("3-A · English · 2026–2027").
    const pick = opts.find((o) => new RegExp(`^${esc(cls)} · (English|İngilizce)( · .+)?$`, 'u').test(o)) ?? opts.find((o) => o === cls);
    if (!pick) continue;
    const current = await sel.evaluate((e) => (e as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '');
    if (current !== pick) {
      await sel.selectOption({ label: pick });
      await page.waitForTimeout(500);
    }
  }
}

/** Clicks every top-level tab of the page's main area and calls `fn` with the tab's key. */
async function eachTab(page: Page, fn: (key: string) => Promise<void>) {
  const tabs = page.locator('main [role="tab"]');
  const n = await tabs.count();
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = (await tabs.nth(i).getAttribute('id')) ?? '';
    keys.push(id.includes('-tab-') ? id.slice(id.lastIndexOf('-tab-') + 5) : String(i + 1));
  }
  for (let i = 0; i < keys.length; i++) {
    await page.locator('main [role="tab"]').nth(i).click();
    await page.waitForTimeout(600);
    await fn(keys[i]!);
  }
  return n;
}

/** Shoots the page, or every tab of it. */
async function pageAndTabs(page: Page, base: Omit<ShotSpec, 'state'>, prepare: () => Promise<void> = async () => undefined) {
  await prepare();
  const n = await page.locator('main [role="tab"]').count();
  if (n === 0) {
    await shot(page, { ...base, state: 'default' });
    return;
  }
  await eachTab(page, async (key) => {
    await prepare();
    await shot(page, { ...base, state: `tab-${key}` });
  });
}

async function waitForHeading(page: Page) {
  await page.locator('main h1, main h2, [data-testid="lock-screen"]').first().waitFor({ timeout: 15_000 });
}

// ================================================================== auth and help
test('auth and help pages', async ({ browser }) => {
  const admin = await signIn(browser, 'admin');
  const ap = admin.page;
  const stamp = Date.now().toString(36);
  try {
    // Invite links (one per interface language) and temporary-password accounts for the forced change.
    const invites: Partial<Record<Locale, string>> = {};
    const temps: Partial<Record<Locale, { login: string; password: string }>> = {};
    for (const lang of ['en', 'tr'] as const) {
      const inv = await api(ap, 'POST', '/api/admin/users', { login: `ux.invite.${lang}.${stamp}`, displayName: lang === 'tr' ? 'Defne Davetli (UX)' : 'Robin Invited (UX)', role: 'teacher', locale: lang, setup: 'invite' });
      if (inv.status === 200 && inv.body.invite?.link) invites[lang] = inv.body.invite.link as string;
      else miss(`auth invite link (${lang}) could not be created`, inv.status);
      const tmp = await api(ap, 'POST', '/api/admin/users', { login: `ux.temp.${lang}.${stamp}`, displayName: lang === 'tr' ? 'Ece Geçici (UX)' : 'Sam Temporary (UX)', role: 'teacher', locale: lang, setup: 'temporary_password' });
      if (tmp.status === 200 && tmp.body.temporaryPassword) temps[lang] = { login: `ux.temp.${lang}.${stamp}`, password: tmp.body.temporaryPassword as string };
      else miss(`auth temporary-password account (${lang}) could not be created`, tmp.status);
    }

    for (const [dev, lang] of OFFICE_RUNS) {
      const S = (page: Page, area: Area, pg: string, state: string) => shot(page, { area, page: pg, state, dev, lang });
      // Signed-out pages (they follow the device language where they have no account to follow).
      const { context, page } = await newPage(browser, dev, lang);
      try {
        await step(`auth/login ${dev.name} ${lang}`, async () => {
          await page.goto('/login');
          await expect(page.locator('input[type="password"]')).toBeVisible();
          await S(page, 'auth', 'login', 'default');
          cover('/login');
          await page.getByRole('button', { name: nm('Email me a sign-in link') }).click();
          await S(page, 'auth', 'login', 'email-link-form');
          await page.getByLabel(nm('Email')).fill(`nobody.${stamp}@school.example`);
          await page.getByRole('button', { name: nm('Send the link') }).click();
          await page.waitForTimeout(800);
          await S(page, 'auth', 'login', 'email-link-sent-code-entry');
        });
        await step(`auth/login wrong password ${dev.name} ${lang}`, async () => {
          await page.goto('/login');
          await page.locator('input[autocomplete="username"], input[name="username"]').first().or(page.getByLabel(nm('Username'))).first().fill('nobody');
          await page.locator('input[type="password"]').fill('not-the-password');
          await page.getByRole('button', { name: nm('Sign in') }).click();
          await page.waitForTimeout(800);
          await S(page, 'auth', 'login', 'wrong-password');
        });
        await step(`auth/reset-password ${dev.name} ${lang}`, async () => {
          await page.goto('/reset-password');
          await waitForHeading(page);
          await S(page, 'auth', 'reset-password', 'no-token');
          cover('/reset-password');
        });
        await step(`auth/invite ${dev.name} ${lang}`, async () => {
          const url = invites[lang];
          if (!url) throw new Error('no invite link');
          await page.goto(url);
          await expect(page.getByRole('radio').first()).toBeVisible();
          await S(page, 'auth', 'invite', 'welcome');
          // Leave /invite first: a goto that changes only the fragment is a same-document navigation.
          await page.goto('/login');
          await page.goto('/invite#token=ux-not-a-real-token-000000000000000000000');
          await page.waitForTimeout(1500);
          await S(page, 'auth', 'invite', 'invalid-link');
          cover('/invite');
        });
        await step(`auth/signin-link ${dev.name} ${lang}`, async () => {
          await page.goto('/signin-link#token=ux-not-a-real-token-000000000000000000000');
          await waitForHeading(page);
          await S(page, 'auth', 'signin-link', 'landing');
          await page.getByRole('button', { name: nm('Sign in') }).first().click();
          await page.waitForTimeout(1500);
          await S(page, 'auth', 'signin-link', 'invalid-after-press');
          cover('/signin-link');
        });
        await step(`help/not-found ${dev.name} ${lang}`, async () => {
          await page.goto('/this-page-does-not-exist');
          await page.waitForTimeout(800);
          await S(page, 'help', 'not-found', 'signed-out');
        });
      } finally {
        await context.close();
      }

      await step(`auth/change-password ${dev.name} ${lang}`, async () => {
        const acc = temps[lang];
        if (!acc) throw new Error('no temporary-password account');
        const s = await newPage(browser, dev, lang);
        try {
          await s.page.goto('/login');
          await s.page.getByLabel(nm('Username')).fill(acc.login);
          await s.page.locator('input[type="password"]').fill(acc.password);
          await s.page.getByRole('button', { name: nm('Sign in') }).click();
          await expect(s.page).toHaveURL(/change-password/u);
          await waitForHeading(s.page);
          await S(s.page, 'auth', 'change-password', 'temporary-password');
          cover('/change-password');
        } finally {
          await s.context.close();
        }
      });

      // Guides (signed in: the administrator, who can open every guide).
      const s = await newPage(browser, dev, lang, { storageState: await admin.context.storageState() });
      try {
        for (const g of GUIDES) {
          await step(`help/guide ${g} ${dev.name} ${lang}`, async () => {
            await s.page.goto(`/help?guide=${g}&lang=${lang}`);
            await expect(s.page.getByTestId('guide').getByRole('heading', { level: 1 })).toBeVisible();
            await s.page.waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 10_000 }).catch(() => undefined);
            await S(s.page, 'help', `guide-${g}`, 'default');
          });
        }
        cover('/help');
        await step(`help/not-found signed-in ${dev.name} ${lang}`, async () => {
          await s.page.goto('/this-page-does-not-exist');
          await s.page.waitForTimeout(800);
          await S(s.page, 'help', 'not-found', 'signed-in');
        });
        if (lang === 'en' && (dev === DEV.desktop || dev === DEV.phone)) {
          await step(`help/dev-catalog ${dev.name}`, async () => {
            await s.page.goto('/dev/catalog');
            await expect(s.page.getByTestId('catalog')).toBeVisible();
            await S(s.page, 'help', 'dev-catalog', 'default');
            cover('/dev/catalog');
          });
        }
      } finally {
        await s.context.close();
      }
    }
    cover('/');
  } finally {
    await admin.context.close();
  }
});

// ================================================================== teacher area
test('teacher area', async ({ browser }) => {
  const teacher = await signIn(browser, 'english');
  const tp = teacher.page;
  await ensurePin(tp);
  await endActiveLessons(tp);
  const ctx3A = await contextOf(tp, '3-A');
  // A homework item due today, so the checking grid has something to show.
  const today = (await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/homework?view=day`)).body.today as string;
  const hwTitle = 'Read pages 12-15 (UX)';
  const hw = await api(tp, 'POST', `/api/teacher/contexts/${ctx3A.id}/homework`, { contextId: ctx3A.id, title: hwTitle, dueOn: today });
  try {
    for (const lang of ['en', 'tr'] as const) {
      await setLocale(tp, lang);
      for (const [dev, l] of OFFICE_RUNS.filter(([, x]) => x === lang)) {
        const { context, page } = await newPage(browser, dev, l, { storageState: await teacher.context.storageState() });
        const base = (pg: string) => ({ area: 'teacher' as const, page: pg, dev, lang: l });
        try {
          await step(`teacher/menu ${dev.name} ${l}`, async () => {
            await page.goto('/teacher');
            await expect(page.getByTestId('teacher-menu')).toBeVisible();
            await shot(page, { ...base('menu'), state: 'default' });
            cover('/teacher');
          });
          for (const p of TEACHER_PATHS) {
            await step(`teacher/${p} ${dev.name} ${l}`, async () => {
              await page.goto(`/teacher/${p}`);
              await waitForHeading(page);
              await page.waitForTimeout(500);
              await pageAndTabs(page, base(p), () => chooseClass(page));
              cover(`/teacher/${p}`);
            });
            await step(`teacher/${p} extra states ${dev.name} ${l}`, () => teacherExtras(page, p, base(p), hwTitle));
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await setLocale(tp, 'en');
    if (hw.status === 200) await api(tp, 'POST', `/api/teacher/homework/${hw.body.id}/archive`, { assignmentId: hw.body.id, archived: true });
    await teacher.context.close();
  }
});

async function teacherExtras(page: Page, p: string, base: Omit<ShotSpec, 'state'>, hwTitle: string) {
  const S = (state: string) => shot(page, { ...base, state });
  const firstTab = async () => {
    const tab = page.locator('main [role="tab"]').first();
    if (await tab.count()) await tab.click();
    await chooseClass(page);
  };
  switch (p) {
    case 'goals': {
      await firstTab();
      await page.getByTestId('goals-page').locator('table button').first().click();
      await expect(page.getByTestId('teacher-student-goals')).toBeVisible();
      await expect(page.getByTestId('teacher-goal').first()).toBeVisible();
      await S('student-with-evidence');
      return;
    }
    case 'reports': {
      await chooseClass(page);
      await page.getByLabel(nm('Period')).first().selectOption({ label: (await page.getByLabel(nm('Period')).first().locator('option').allInnerTexts()).find((o) => /^(month|ay)$/iu.test(o.trim()))! }).catch(() => undefined);
      await page.waitForTimeout(1000);
      await S('class-month');
      // S14e1 (D-153): the view bar with the Customise tree open.
      await step(`teacher/reports customise ${base.dev.name} ${base.lang}`, async () => {
        const customise = page.getByRole('button', { name: nm('Customise') }).first();
        await customise.click();
        await expect(page.getByTestId('report-view-tree')).toBeVisible();
        await S('views-customise-open');
        await customise.click();
      });
      const student = page.getByLabel(nm('Student')).first();
      const opts = await student.locator('option').allInnerTexts();
      if (opts.length > 1) {
        await student.selectOption({ index: 1 });
        await page.waitForTimeout(1200);
        await S('student-with-timeline');
      } else miss(`teacher/reports student timeline ${base.dev.name} ${base.lang}: no student to choose`);
      await page.emulateMedia({ media: 'print' });
      await S('print-preview');
      await page.emulateMedia({ media: 'screen' });
      return;
    }
    case 'student-links': {
      await chooseClass(page);
      await expect(page.getByTestId('link-row').first()).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      await S('print-preview');
      await page.emulateMedia({ media: 'screen' });
      await page.getByTestId('link-row').first().getByRole('button').first().click();
      await page.waitForTimeout(600);
      await S('first-row-action');
      await page.keyboard.press('Escape');
      return;
    }
    case 'grouping': {
      await firstTab();
      await page.getByTestId('grouping-page').getByRole('button', { name: nm('Edit groups') }).first().click();
      const editor = page.getByTestId('grouping-editor');
      await expect(editor).toBeVisible();
      await S('editor');
      await editor.getByTestId('editor-member').first().click();
      await page.waitForTimeout(300);
      await S('editor-member-selected');
      await editor.getByRole('button', { name: nm('Cancel') }).first().click();
      return;
    }
    case 'homework': {
      await firstTab();
      for (let i = 0; i < 4 && (await page.getByTestId('homework-item').count()) === 0; i++) {
        await page.getByRole('button', { name: nm('Previous') }).first().click();
        await page.waitForTimeout(400);
      }
      const item = page.getByTestId('homework-item').filter({ hasText: hwTitle }).or(page.getByTestId('homework-item')).first();
      await item.getByRole('button').first().click();
      const grid = page.getByTestId('homework-check');
      await expect(grid).toBeVisible();
      await S('check-grid');
      await grid.getByTestId('homework-row').first().locator('strong').click();
      await grid.getByTestId('homework-row').nth(2).locator('strong').click();
      await S('check-grid-two-selected');
      return;
    }
    case 'achievements': {
      await firstTab();
      const open = page.getByTestId('achievements-student-open').first();
      if (await open.count()) {
        await open.click();
        await page.waitForTimeout(600);
        await S('student-dialog');
        await page.keyboard.press('Escape');
      }
      return;
    }
    case 'avatars': {
      return;
    }
    case 'students': {
      // S14e2 (D-154): a student's name opens the statistics drawer.
      await chooseClass(page);
      await page.getByTestId('student-name').first().click();
      const drawer = page.getByTestId('student-stats');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByTestId('student-stats-report')).toBeVisible();
      await page.waitForTimeout(800);
      await S('stats-drawer');
      await drawer.getByTestId('dialog-close').click();
      return;
    }
    default:
      return;
  }
}

// ================================================================== classroom
test('classroom', async ({ browser }) => {
  const teacher = await signIn(browser, 'english');
  const admin = await signIn(browser, 'admin');
  const tp = teacher.page;
  const ap = admin.page;
  await ensurePin(tp);
  await endActiveLessons(tp);
  const ctx3A = await contextOf(tp, '3-A');
  const originalTheme = await classTheme(ap, ctx3A.classId);
  const hwSettings = (await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/homework/settings`)).body as { checkingInClassroom: boolean };
  await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/homework/settings`, { contextId: ctx3A.id, checkingInClassroom: true });
  const today = (await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/homework?view=day`)).body.today as string;
  const hwTitle = 'Spelling list 7 (UX)';
  const hw = await api(tp, 'POST', `/api/teacher/contexts/${ctx3A.id}/homework`, { contextId: ctx3A.id, title: hwTitle, dueOn: today });
  // The End Lesson "Well done!" step is shown only when the class chose it.
  const achSettings = (await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/achievements`)).body?.settings as { announce?: string } | undefined;
  await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/achievements/settings`, { contextId: ctx3A.id, announce: 'endOfLesson' });
  try {
    await setClassTheme(ap, ctx3A.classId, DEFAULT_THEME);
    const runs: Array<[Device, Locale]> = [
      [DEV.desktop, 'en'],
      [DEV.display720, 'en'],
      [DEV.display4k, 'en'],
      [DEV.laptop, 'en'],
      [DEV.tablet, 'en'],
      [DEV.desktop, 'tr'],
      [DEV.display720, 'tr'],
    ];
    for (const lang of ['en', 'tr'] as const) {
      // The classroom follows the class language; the lock screen follows the teacher's own.
      await setLocale(tp, lang);
      await setClassLanguage(tp, ctx3A.classId, lang === 'tr' ? { mainLanguage: 'tr', secondLanguageEnabled: true } : { mainLanguage: 'en', secondLanguageEnabled: false });
      for (const [dev, l] of runs.filter(([, x]) => x === lang)) {
        const run = runs.findIndex(([d2, l2]) => d2 === dev && l2 === l);
        await step(`classroom full flow ${dev.name} ${l}`, () => classroomFlow(browser, tp, dev, l, hwTitle, run));
      }
    }
    cover('/classroom');

    // The dashboard in the other themes.
    await setLocale(tp, 'en');
    await setClassLanguage(tp, ctx3A.classId, { mainLanguage: 'en', secondLanguageEnabled: false });
    for (const theme of OTHER_THEMES) {
      await setClassTheme(ap, ctx3A.classId, theme);
      for (const [dev, l] of [
        [DEV.desktop, 'en'],
        [DEV.display720, 'en'],
        [DEV.display4k, 'en'],
      ] as Array<[Device, Locale]>) {
        await step(`classroom dashboard ${theme} ${dev.name} ${l}`, async () => {
          await endActiveLessons(tp);
          const r = await api(tp, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx3A.id, payload: { contextId: ctx3A.id, othersPresent: true, attendance: [] } }] });
          expect(r.body.results[0].ok).toBe(true);
          const { context, page } = await newPage(browser, dev, l);
          try {
            await login(page, 'english');
            await openClass(page);
            await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await page.waitForTimeout(800);
            await shot(page, { area: 'classroom', page: 'dashboard', state: 'density-normal', dev, lang: l });
          } finally {
            await context.close();
          }
        });
      }
    }
  } finally {
    await endActiveLessons(tp);
    await setClassTheme(ap, ctx3A.classId, originalTheme);
    await setClassLanguage(tp, ctx3A.classId, { mainLanguage: 'en', secondLanguageEnabled: false });
    await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/homework/settings`, { contextId: ctx3A.id, checkingInClassroom: hwSettings.checkingInClassroom });
    await api(tp, 'PUT', `/api/teacher/contexts/${ctx3A.id}/achievements/settings`, { contextId: ctx3A.id, announce: achSettings?.announce ?? 'off' });
    if (hw.status === 200) await api(tp, 'POST', `/api/teacher/homework/${hw.body.id}/archive`, { assignmentId: hw.body.id, archived: true });
    await setLocale(tp, 'en');
    await teacher.context.close();
    await admin.context.close();
  }
});

async function openClass(page: Page) {
  await page.goto('/classroom');
  await page.getByRole('button', { name: /^3-A · (English|İngilizce)/u }).first().click();
}

/** The whole lesson on one display device: its own sign-in, so classroom mode locks only this session. */
async function classroomFlow(browser: Browser, tp: Page, dev: Device, lang: Locale, hwTitle: string, run: number) {
  await endActiveLessons(tp);
  const { context, page: d } = await newPage(browser, dev, lang);
  const S = (pg: string, state: string, animations: 'allow' | 'disabled' = 'disabled') => shot(d, { area: 'classroom', page: pg, state, dev, lang, animations });
  const where = `${dev.name} ${lang}`;
  try {
    await login(d, 'english');
    await openClass(d);
    await expect(d.getByTestId('no-lesson')).toBeVisible();
    await S('menu', 'no-lesson-class-switcher');

    // Start Lesson, every step (the topic step is named).
    await d.getByRole('button', { name: nm('Start lesson') }).click();
    const start = d.getByTestId('start-lesson');
    await expect(start).toBeVisible();
    for (let i = 1; i <= 8; i++) {
      await d.waitForTimeout(400);
      const isTopic = (await start.getByTestId('topic-step').count()) > 0;
      await S('start-lesson', `step${i}${isTopic ? '-topic' : ''}`);
      if (isTopic) {
        const choice = start.getByTestId('topic-step').getByRole('button').first();
        if (await choice.count()) {
          await choice.click().catch(() => undefined);
          await d.waitForTimeout(300);
          await S('start-lesson', `step${i}-topic-chosen`);
        }
      }
      const begin = start.getByRole('button', { name: nm('Begin lesson') });
      if (await begin.count()) {
        await begin.click();
        break;
      }
      await start.getByRole('button', { name: nm('Next') }).click();
    }
    const dashboard = d.getByTestId('lesson-dashboard');
    await expect(dashboard).toBeVisible();
    await d.waitForTimeout(1000);
    await S('dashboard', 'density-normal');

    await step(`classroom density ${where}`, async () => {
      // Size is in the top bar's Display popover (D-139); the popover closes on a click outside.
      const control = d.getByTestId('density-control');
      const pick = async (name: string) => {
        if (!(await control.isVisible())) await d.getByTestId('classroom-settings').click();
        await control.getByRole('button', { name: nm(name) }).click();
        await d.keyboard.press('Escape');
      };
      await pick('Compact');
      await S('dashboard', 'density-compact');
      await pick('Large');
      await S('dashboard', 'density-large');
      await pick('Normal');
    });

    // S14a (D-145): the Display popover with the size, Customise layout and the Sound check.
    await step(`classroom display popover and sound check ${where}`, async () => {
      await d.getByTestId('classroom-settings').click();
      await expect(d.getByTestId('sound-check')).toBeVisible();
      await S('display-popover', 'sound-check');
      await d.keyboard.press('Escape');
    });

    // S14e2 (D-154): a card's name opens the small positive card (never statistics).
    await step(`classroom student card ${where}`, async () => {
      await d.getByTestId('student-card-name').nth(2).click();
      const card = d.getByTestId('classroom-student-card');
      await expect(card).toBeVisible();
      await d.waitForTimeout(600);
      await S('student-card', 'positive-card');
      await card.getByTestId('dialog-close').click();
      await expect(card).toBeHidden();
    });

    // S14b (D-148): every button of the dock opens its full-screen view.
    await step(`classroom dock views ${where}`, async () => {
      const dock = d.getByTestId('lesson-dock');
      await expect(dock).toBeVisible();
      const keys = await dock.locator('button[data-testid^="dock-"][aria-haspopup="dialog"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.slice(5)));
      for (const key of keys) {
        await step(`classroom dock view ${key} ${where}`, async () => {
          await d.getByTestId(`dock-${key}`).click();
          const view = d.getByTestId(`dock-view-${key}`);
          await expect(view).toBeVisible();
          await d.waitForTimeout(500);
          await S('dock-view', key);
          await view.getByTestId('dialog-close').click();
          await expect(view).toBeHidden();
        });
      }
    });

    // S14b (D-148): Customise layout asks for the PIN, then the editor; Cancel relocks.
    await step(`classroom layout editor ${where}`, async () => {
      await d.getByTestId('classroom-settings').click();
      const customise = d.getByTestId('customise-layout');
      if (await customise.isDisabled()) {
        await S('display-popover', 'customise-needs-wider-screen');
        await d.keyboard.press('Escape');
        return;
      }
      await customise.click();
      const dialog = d.getByTestId('pin-dialog');
      await expect(dialog).toBeVisible();
      await S('layout-editor', 'pin-dialog');
      await dialog.locator('input').first().fill(PIN);
      await dialog.locator('input').first().press('Enter');
      const editor = d.getByTestId('layout-editor');
      await expect(editor).toBeVisible();
      await d.waitForTimeout(500);
      await S('layout-editor', 'editing');
      await d.locator('[data-testid^="layout-frame-"]').first().click().catch(() => undefined);
      await d.waitForTimeout(300);
      await S('layout-editor', 'box-selected');
      await editor.getByRole('button', { name: nm('Cancel') }).click();
      await expect(editor).toHaveCount(0);
    });

    await step(`classroom routine next stage ${where}`, async () => {
      const next = d.getByRole('button', { name: nm('Next stage') });
      if (await next.count()) {
        await next.first().click();
        await S('dashboard', 'routine-next-stage');
      }
    });

    await step(`classroom timer keypad ${where}`, async () => {
      await d.getByTestId('timer').getByRole('button', { name: nm('Set time') }).click();
      const keypad = d.getByTestId('timer-keypad');
      await expect(keypad).toBeVisible();
      await S('timer-keypad', 'empty');
      for (const k of ['1', '3', '0']) await keypad.getByRole('button', { name: k, exact: true }).click();
      await S('timer-keypad', 'typed-01-30');
      await keypad.getByRole('button', { name: nm('Set time') }).click();
      await expect(keypad).toHaveCount(0);
      await d.getByTestId('timer').getByRole('button', { name: nm('Start') }).click().catch(() => undefined);
      await d.waitForTimeout(1200);
      await S('dashboard', 'timer-running');
      await d.getByTestId('timer').getByRole('button', { name: nm('Pause') }).click().catch(() => undefined);
    });

    await step(`classroom group screen ${where}`, async () => {
      // Groups open from the board's dock (S14b): the dock view is the group screen.
      await d.getByTestId('dock-groups').click();
      const screen = d.getByTestId('dock-view-groups');
      await expect(screen).toBeVisible();
      await S('group-screen', 'opened');
      const option = screen.getByTestId('group-options').getByRole('button').first();
      if (await option.count()) await option.click();
      await d.waitForTimeout(800);
      await S('group-screen', 'option-chosen');
      const member = screen.getByTestId('group-member').first();
      if (await member.count()) {
        await member.click();
        await d.waitForTimeout(300);
        await S('group-screen', 'member-picked-to-move');
      }
      await d.keyboard.press('Escape');
      if (await screen.isVisible()) await d.keyboard.press('Escape');
      await expect(screen).toBeHidden();
      await S('dashboard', 'groups-chosen');
    });

    await step(`classroom assistant ${where}`, async () => {
      await d.getByTestId('dock-assistant').click();
      const panel = d.getByTestId('assistant-panel');
      await expect(panel).toBeVisible();
      const duty = panel.getByTestId('assistant-duties').getByRole('checkbox').first();
      if (await duty.count()) await duty.check();
      await S('assistant', 'panel-duty-ticked');
      await d.getByTestId('assistant-hide').click();
      await S('assistant', 'hidden');
      await d.getByTestId('assistant-show').click();
      await d.getByTestId('dock-view-assistant').getByTestId('dialog-close').click();
    });

    await step(`classroom secret students ${where}`, async () => {
      await d.getByTestId('dock-secret').click();
      const panel = d.getByTestId('secret-panel');
      await panel.getByRole('button', { name: nm('Choose secret students') }).click();
      await expect(panel.getByTestId('secret-count')).toBeVisible();
      await S('secret-student', 'chosen');
      await d.getByTestId('dock-view-secret').getByTestId('dialog-close').click();
    });

    await step(`classroom badge and celebrate ${where}`, async () => {
      await d.getByTestId('dock-achievements').click();
      const panel = d.getByTestId('achievements-panel');
      await panel.getByTestId('achievements-give').click();
      const dialog = d.getByTestId('achievements-dialog');
      await expect(dialog).toBeVisible();
      await S('celebrate', 'give-badge-dialog');
      // A different student on every run, so the badge is new each time.
      await dialog.getByTestId('achievements-student').nth(run + 1).check();
      await dialog.getByTestId('achievements-badge').first().click();
      await S('celebrate', 'give-badge-chosen');
      await dialog.getByTestId('achievements-confirm').click();
      const moment = d.getByTestId('achievements-moment');
      await expect(moment).toBeVisible();
      await S('celebrate', 'badge-moment');
      await moment.getByRole('button', { name: nm('Celebrate again') }).click();
      await expect(d.getByTestId('celebration')).toBeVisible();
      await d.waitForTimeout(400);
      await S('celebrate', 'celebration-overlay', 'allow');
      await expect(d.getByTestId('celebration')).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      await moment.getByTestId('achievements-moment-close').click();
      await S('dashboard', 'after-badge-undo-offered');
      await d.getByTestId('dock-view-achievements').getByTestId('dialog-close').click();
    });

    await step(`classroom homework checking dialog ${where}`, async () => {
      await d.getByTestId('dock-homework').click();
      await d.getByTestId('homework-panel').getByRole('button', { name: new RegExp(esc(hwTitle), 'u') }).first().click();
      const dialog = d.getByRole('dialog').filter({ has: d.getByTestId('homework-check') });
      const grid = dialog.getByTestId('homework-check');
      await expect(grid).toBeVisible();
      await S('homework-check', 'dialog');
      await grid.getByTestId('homework-row').nth(1).locator('strong').click();
      await grid.getByTestId('homework-row').nth(3).locator('strong').click();
      await S('homework-check', 'two-selected');
      await dialog.getByRole('button', { name: nm('Close') }).first().click().catch(() => d.keyboard.press('Escape'));
      await expect(grid).toBeHidden();
      await d.getByTestId('dock-view-homework').getByTestId('dialog-close').click();
    });

    // End Lesson: secret reveal, celebrate one, "Well done", save, summary.
    await d.getByRole('button', { name: nm('End lesson') }).click();
    const end = d.getByTestId('end-lesson');
    await expect(end).toBeVisible();
    await d.waitForTimeout(500);
    await S('end-lesson', 'before-reveal');
    await step(`classroom secret reveal ${where}`, async () => {
      await end.getByRole('button', { name: nm('Reveal the secret students') }).click();
      const cards = end.getByTestId('secret-reveal').getByTestId('secret-reveal-card');
      await expect(cards.first()).toBeVisible();
      await d.waitForTimeout(2500);
      await S('secret-reveal', 'revealed');
      await cards.nth(0).getByRole('radio', { name: nm('Goal met') }).click();
      if ((await cards.count()) > 1) {
        await cards.nth(1).getByRole('radio', { name: nm('Still practising') }).click();
        // The switch input is visually hidden: press its visible label ("Celebrate {name}").
        const celebrateLabel = new RegExp(`^(${[EN['secret.celebrate'], TR['secret.celebrate']].map((t) => esc(t ?? '').replace('\\{name\\}', '.+')).join('|')})$`, 'u');
        await cards.nth(1).getByText(celebrateLabel).click();
        await expect(d.getByTestId('celebration')).toBeVisible();
        await d.waitForTimeout(400);
        await S('secret-reveal', 'celebrate-student-overlay', 'allow');
        await expect(d.getByTestId('celebration')).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      }
    });
    await step(`classroom well done ${where}`, async () => {
      const wellDone = end.getByTestId('achievements-well-done');
      // The list holds automatic badges only; without one the step says "No new badges this lesson".
      const hasList = (await wellDone.count()) > 0;
      await S('end-lesson', hasList ? 'outcomes-and-well-done-list' : 'outcomes-and-well-done-empty');
    });
    await end.getByRole('button', { name: nm('Save and end lesson') }).click();
    await expect(d.getByTestId('lesson-summary')).toBeVisible();
    await S('end-lesson', 'summary');

    // The teacher area is locked in classroom mode: PIN, then the teacher menu with the display banner.
    await step(`classroom PIN lock ${where}`, async () => {
      await d.getByRole('button', { name: nm('Teacher area') }).click();
      await expect(d.getByTestId('lock-screen')).toBeVisible();
      await S('pin-lock', 'locked');
      for (const k of PIN.slice(0, 3)) await d.getByTestId('lock-screen').getByRole('button', { name: k, exact: true }).click();
      await S('pin-lock', 'three-digits-typed');
      for (const k of PIN.slice(3)) await d.getByTestId('lock-screen').getByRole('button', { name: k, exact: true }).click();
      await d.getByRole('button', { name: nm('Unlock') }).click().catch(() => undefined);
      await expect(d.getByTestId('teacher-menu')).toBeVisible();
      await S('menu', 'teacher-menu-unlocked-display-banner');
      await d.getByTestId('display-banner').getByRole('button', { name: nm('Back to the classroom') }).click();
      await expect(d.getByTestId('classroom-shell')).toBeVisible();
    });
  } finally {
    await context.close();
    await endActiveLessons(tp);
  }
}

// ================================================================== administration
test('administration', async ({ browser }) => {
  const admin = await signIn(browser, 'admin');
  const ap = admin.page;
  const stamp = Date.now().toString(36);
  // A fictional deactivated student, for the permanent-deletion preview.
  const classes = (await api(ap, 'GET', '/api/admin/classes')).body.classes as Array<{ id: string; name: string }>;
  const c3B = classes.find((c) => c.name === '3-B')!;
  const eraseName = 'Defne Silinecek Örnek';
  const added = await api(ap, 'POST', '/api/admin/students', { classId: c3B.id, fullName: eraseName, allowDuplicateName: true });
  if (added.status === 200) await api(ap, 'POST', `/api/admin/students/${added.body.id}/deactivate`, {});
  else miss('admin erase-preview student could not be created', added.status);
  try {
    for (const lang of ['en', 'tr'] as const) {
      await setLocale(ap, lang);
      for (const [dev, l] of OFFICE_RUNS.filter(([, x]) => x === lang)) {
        const { context, page } = await newPage(browser, dev, l, { storageState: await admin.context.storageState() });
        const base = (pg: string) => ({ area: 'admin' as const, page: pg, dev, lang: l });
        try {
          for (const p of ADMIN_PATHS) {
            const name = p || 'home';
            await step(`admin/${name} ${dev.name} ${l}`, async () => {
              await page.goto(`/admin/${p}`);
              await waitForHeading(page);
              await page.waitForTimeout(700);
              await pageAndTabs(page, base(name), () => chooseClass(page));
              cover(`/admin/${p}`.replace(/\/$/u, ''));
            });
            await step(`admin/${name} extra states ${dev.name} ${l}`, () => adminExtras(page, name, base(name), `${stamp}${dev.name.slice(0, 2)}${l}`, eraseName));
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await setLocale(ap, 'en');
    await admin.context.close();
  }
});

async function adminExtras(page: Page, p: string, base: Omit<ShotSpec, 'state'>, stamp: string, eraseName: string) {
  const S = (state: string) => shot(page, { ...base, state });
  switch (p) {
    case 'users': {
      await page.getByRole('button', { name: nm('New account') }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await S('new-account-dialog');
      await dialog.getByLabel(nm('Username')).fill(`ux.new.${stamp}`);
      await dialog.getByLabel(nm('Name')).first().fill('Kim Example (UX)');
      await dialog.getByRole('button', { name: nm('New account') }).click();
      await expect(page.getByTestId('invite-link')).toBeVisible();
      await S('invite-created');
      await page.getByRole('button', { name: nm('Done') }).click();
      await page.waitForTimeout(400);
      await S('with-invite-pending');
      return;
    }
    case 'classes': {
      await page.goto('/admin/classes?new=1');
      await expect(page.getByRole('dialog')).toBeVisible();
      await S('new-class-dialog');
      await page.keyboard.press('Escape');
      return;
    }
    case 'students': {
      // The fictional student is in 3-B (the page shots above filter on 3-A).
      await chooseClass(page, '3-B');
      await page.getByLabel(nm('Search by name or number')).fill(eraseName);
      const include = page.getByRole('switch', { name: nm('Include deactivated students') });
      if (!(await include.isChecked())) await include.click({ force: true });
      await page.waitForTimeout(1000);
      await S('search-deactivated');
      const row = page
        .locator('tr, li, .cc-card')
        .filter({ hasText: eraseName })
        .filter({ has: page.getByRole('button', { name: nm('Delete permanently') }) })
        .last();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: nm('Link') }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await S('link-dialog-deactivated');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await row.getByRole('button', { name: nm('Delete permanently') }).click();
      await expect(page.getByTestId('erase-preview')).toBeVisible();
      await S('erase-preview');
      await page.keyboard.press('Escape');
      return;
    }
    case 'themes': {
      // S14g (D-158): the worked example checked and previewed (not saved).
      await page.getByTestId('theme-file').setInputFiles({ name: 'ocean.theme.json', mimeType: 'application/json', buffer: Buffer.from(read('docs/examples/ocean.theme.json')) });
      await page.getByRole('button', { name: nm('Check package') }).click();
      await expect(page.getByTestId('theme-package-preview')).toBeVisible();
      await page.waitForTimeout(600);
      await S('import-preview');
      return;
    }
    default:
      return;
  }
}

// ================================================================== student page
test('student page', async ({ browser }) => {
  const teacher = await signIn(browser, 'english');
  const admin = await signIn(browser, 'admin');
  const tp = teacher.page;
  const ap = admin.page;
  const ctx3A = await contextOf(tp, '3-A');
  const ctx3B = await contextOf(tp, '3-B');
  const originalTheme = await classTheme(ap, ctx3A.classId);
  const setMedia = async (on: boolean) => {
    for (const m of ['media.evidencePhotos', 'media.evidenceAudio']) await api(ap, 'PUT', `/api/admin/module-policies/${m}`, { availability: on ? 'enabled' : 'disabled' });
  };
  // A student with goals and evidence from the demo history.
  const students = (await api(tp, 'GET', `/api/teacher/classes/${ctx3A.classId}/student-links`)).body.students as Array<{ id: string; link: { url: string | null } | null }>;
  const withLink = students.filter((s) => s.link?.url);
  let chosen = withLink[0]!.id;
  for (const s of withLink) {
    const g = await api(tp, 'GET', `/api/teacher/contexts/${ctx3A.id}/students/${s.id}/goals`);
    if (g.status === 200 && ((g.body?.goals ?? []) as Array<{ status: string }>).some((x) => x.status !== 'archived') && (g.body?.evidence?.length ?? 0) > 0) {
      chosen = s.id;
      break;
    }
  }
  const url = await studentLinkUrl(tp, ctx3A.classId, chosen);
  const roster3B = (await api(tp, 'GET', `/api/classroom/contexts/${ctx3B.id}/roster`)).body.students as Array<{ id: string }>;
  const url3B = await studentLinkUrl(tp, ctx3B.classId, roster3B[2]!.id);

  const runs: Array<[Device, Locale, string]> = [
    [DEV.phone, 'en', DEFAULT_THEME],
    ...OTHER_THEMES.map((t): [Device, Locale, string] => [DEV.phone, 'en', t]),
    [DEV.tablet, 'en', DEFAULT_THEME],
    [DEV.desktop, 'en', DEFAULT_THEME],
    [DEV.phone, 'tr', DEFAULT_THEME],
    [DEV.desktop, 'tr', DEFAULT_THEME],
  ];
  try {
    await setMedia(true);
    for (const [dev, lang, theme] of runs) {
      await setClassTheme(ap, ctx3A.classId, theme);
      await setClassLanguage(tp, ctx3A.classId, lang === 'tr' ? { mainLanguage: 'tr', secondLanguageEnabled: true } : { mainLanguage: 'en', secondLanguageEnabled: false });
      const full = theme === DEFAULT_THEME;
      await step(`student page ${dev.name} ${lang} ${theme}`, () => studentRun(browser, dev, lang, url, full));
    }
    // A Turkish-only student page for an English-only class (the class's student-page override).
    await setClassTheme(ap, ctx3A.classId, originalTheme);
    await step('student page Turkish-only class', async () => {
      await setClassLanguage(tp, ctx3B.classId, { mainLanguage: 'en', secondLanguageEnabled: false, studentPage: { mainLanguage: 'tr', secondLanguageEnabled: false } });
      for (const dev of [DEV.phone, DEV.desktop]) {
        const { context, page } = await newPage(browser, dev, 'tr');
        try {
          await page.goto(url3B);
          await expect(page.getByTestId('student-page')).toBeVisible();
          await page.waitForTimeout(800);
          await shot(page, { area: 'student', page: 'page', state: 'turkish-only-class', dev, lang: 'tr' });
        } finally {
          await context.close();
        }
      }
    });
    // A link that does not work.
    await step('student page link gone', async () => {
      for (const [dev, lang] of [
        [DEV.phone, 'en'],
        [DEV.phone, 'tr'],
      ] as Array<[Device, Locale]>) {
        const { context, page } = await newPage(browser, dev, lang);
        try {
          await page.addInitScript((l) => localStorage.setItem('cc.studentLocale', l), lang);
          await page.goto('/s#ux-not-a-real-link-token-00000000000000000000');
          await expect(page.getByTestId('student-link-gone')).toBeVisible();
          await shot(page, { area: 'student', page: 'page', state: 'link-gone', dev, lang });
        } finally {
          await context.close();
        }
      }
    });
  } finally {
    await setMedia(false);
    await setClassTheme(ap, ctx3A.classId, originalTheme);
    await setClassLanguage(tp, ctx3A.classId, { mainLanguage: 'en', secondLanguageEnabled: false });
    await setClassLanguage(tp, ctx3B.classId, { mainLanguage: 'en', secondLanguageEnabled: false, studentPage: null });
    await teacher.context.close();
    await admin.context.close();
  }
});

async function studentRun(browser: Browser, dev: Device, lang: Locale, url: string, full: boolean) {
  const { context, page } = await newPage(browser, dev, lang, { permissions: ['camera', 'microphone'] });
  const S = (pg: string, state: string) => shot(page, { area: 'student', page: pg, state, dev, lang });
  const where = `${dev.name} ${lang}`;
  try {
    await page.addInitScript((l) => localStorage.setItem('cc.studentLocale', l), lang);
    await page.goto(url);
    await expect(page.getByTestId('student-page')).toBeVisible();
    await page.waitForTimeout(1000);
    await S('page', 'default');
    if (!full) return;
    // S14d (D-151): home tiles and short steps. Each tile is opened from the home screen.
    const home = async () => {
      await page.goto(new URL(page.url()).pathname);
      await expect(page.getByTestId('student-page')).toBeVisible();
    };
    const tile = (en: string) => page.getByRole('link', { name: nm(en, false) }).first();

    await step(`student new goal ${where}`, async () => {
      await tile('New goal').click();
      await page.waitForTimeout(400);
      await S('new-goal', 'step-1-categories');
      await page.locator('.cc-student-choices .cc-student-choice').first().click();
      await page.waitForTimeout(300);
      await S('new-goal', 'step-2-goals');
      const own = page.getByRole('button', { name: nm('My own words') });
      if (await own.count()) await own.click();
      const chip = page.getByTestId('sentence-starters').getByRole('button').first();
      if (await chip.count()) await chip.click();
      await page.waitForTimeout(300);
      await S('new-goal', 'step-2-own-words-starters');
    });

    await step(`student how is it going ${where}`, async () => {
      await home();
      await tile('How is it going?').click();
      const first = page.locator('.cc-student-choices--list .cc-student-choice').first();
      if (!(await first.count())) return miss(`student how is it going: no goal ${where}`);
      await first.click();
      await page.waitForTimeout(300);
      await S('how-is-it-going', 'step-2-faces');
      await page.getByTestId('how-face-4').click();
      await page.getByTestId('sentence-starters').getByRole('button').first().click();
      await page.keyboard.type(lang === 'tr' ? 'her gün okudum' : 'I read every day');
      await page.waitForTimeout(300);
      await S('how-is-it-going', 'step-3-starter-filled');
    });

    await step(`student evidence adder ${where}`, async () => {
      await home();
      await tile('Show my work').click();
      const form = page.getByTestId('evidence-form');
      await expect(form).toHaveAttribute('data-step', 'how');
      const workUrl = page.url();
      await S('evidence-adder', 'step-1-kinds');
      const buttons = form.locator('.cc-evidence-modes').getByRole('button');
      const n = await buttons.count();
      if (n < 7) miss(`student evidence adder shows ${n} of 7 kinds ${where}`);
      for (let i = 0; i < n; i++) {
        await page.goto(workUrl);
        await expect(form).toHaveAttribute('data-step', 'how');
        const b = buttons.nth(i);
        const text = (await b.innerText()).trim();
        await b.click();
        if ((await form.getAttribute('data-step')) === 'goal') {
          if (i === 0) await S('evidence-adder', 'step-2-which-goal');
          await form.locator('.cc-student-choice').first().click();
        }
        await page.waitForTimeout(700);
        await S('evidence-adder', `mode-${slug(keyOf(text) ?? text).replace(/^evidence-mode-/u, '')}`);
      }
    });

    await step(`student my goals ${where}`, async () => {
      await home();
      await tile('My goals').click();
      await page.waitForTimeout(400);
      await S('goals', 'my-goals');
    });

    await step(`student achievements ${where}`, async () => {
      await home();
      const t = tile('My achievements');
      if (!(await t.count())) return miss(`student achievements: no tile ${where}`);
      await t.click();
      const ach = page.getByTestId('student-achievements').first();
      // The state is "every badge": open both lists (earned and still to earn) when they are folded.
      for (const id of ['student-badges-earned-all', 'student-badges-all']) {
        const all = ach.getByTestId(id);
        if ((await all.count()) && (await all.getAttribute('aria-expanded')) === 'false') await all.click();
      }
      await page.waitForTimeout(400);
      if ((await page.getByTestId('student-badge-locked').count()) === 0) miss(`student achievements: no locked badge with progress ${where}`);
      await S('achievements', 'all-badges-with-locked-progress');
    });

    await step(`student avatar creator ${where}`, async () => {
      await home();
      await tile('My avatar').click();
      await page.getByTestId('avatar-change').first().click();
      const creator = page.getByTestId('avatar-creator');
      await expect(creator).toBeVisible();
      await S('avatar-creator', 'ready-made');
      await creator.getByTestId('avatar-tab-make').click();
      await creator.getByTestId('avatar-type-person').click();
      await S('avatar-creator', 'make-person');
      await creator.getByTestId('avatar-type-creature').click();
      await creator.getByTestId('avatar-randomise').click();
      await S('avatar-creator', 'make-creature-randomised');
      await page.keyboard.press('Escape');
    });

    await step(`student help ${where}`, async () => {
      await page.reload();
      await expect(page.getByTestId('student-page')).toBeVisible();
      await page.getByRole('button', { name: nm('Help') }).first().click();
      await expect(page.getByTestId('help-panel')).toBeVisible();
      await page.waitForTimeout(800);
      await S('help', 'student-guide');
    });
  } finally {
    await context.close();
  }
}

// ================================================================== Super Speakers: scorer and board
test('super speakers scorer and board', async ({ browser }) => {
  const admin = await signIn(browser, 'admin');
  const ap = admin.page;
  expect((await api(ap, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: 'enabled' })).status).toBe(200);
  const before = (await api(ap, 'GET', '/api/admin/speakers')).body as { settings: { theme: string; boardLanguage: Locale }; scorerLinks: Array<{ url: string | null }>; displayLinks: Array<{ url: string | null }> };
  const scorerUrl = before.scorerLinks.find((l) => l.url)?.url;
  const boardUrl = before.displayLinks.find((l) => l.url)?.url;
  try {
    // ---------------------------------------------------------------- scorer
    for (const [dev, lang] of [
      [DEV.phone, 'en'],
      [DEV.tablet, 'en'],
      [DEV.desktop, 'en'],
      [DEV.phone, 'tr'],
      [DEV.desktop, 'tr'],
    ] as Array<[Device, Locale]>) {
      const where = `${dev.name} ${lang}`;
      await step(`scorer ${where}`, async () => {
        if (!scorerUrl) throw new Error('no scorer link in the demo school');
        const { context, page } = await newPage(browser, dev, lang);
        const S = (pg: string, state: string) => shot(page, { area: 'superSpeakers', page: pg, state, dev, lang });
        try {
          await page.addInitScript((l) => localStorage.setItem('cc.scorerLocale', l), lang);
          await page.goto(scorerUrl);
          const startBtn = page.getByTestId('scorer-start');
          await expect(startBtn.or(page.getByTestId('scorer-app'))).toBeVisible();
          if (await startBtn.isVisible()) {
            await S('scorer', 'welcome-install');
            await step(`scorer pairing code ${where}`, async () => {
              // The iPhone steps (with the pairing code) are folded away on other phones.
              const ios = page.getByTestId('scorer-install').locator('details').nth(1);
              if (!(await ios.evaluate((d) => (d as HTMLDetailsElement).open))) await ios.locator('summary').click();
              await S('scorer', 'welcome-iphone-steps-open');
              await page.getByTestId('make-pairing-code').click();
              await expect(page.getByTestId('pairing-code')).toBeVisible();
              await S('scorer', 'pairing-code-shown');
            });
            await startBtn.click();
          }
          await expect(page.getByTestId('scorer-app')).toBeVisible();
          await page.waitForTimeout(600);
          await S('scorer', 'app-empty-search');
          await page.getByTestId('scorer-search').fill('3a');
          await expect(page.getByTestId('scorer-results').getByTestId('scorer-student').first()).toBeVisible();
          await S('scorer', 'search-class-3a');
          await page.getByTestId('scorer-search').fill('ay');
          await page.waitForTimeout(500);
          await S('scorer', 'search-name');
          await step(`scorer give and undo ${where}`, async () => {
            const card = page.getByTestId('scorer-results').getByTestId('scorer-student').first();
            await card.getByRole('button').last().click();
            await expect(page.getByTestId('scorer-undo-bar')).toBeVisible();
            await S('scorer', 'undo-bar-after-point');
            await page.getByTestId('scorer-undo').click();
            await page.waitForTimeout(800);
            await S('scorer', 'after-undo-today-list');
          });
          await step(`scorer help ${where}`, async () => {
            await page.getByRole('button', { name: nm('Help') }).first().click();
            await expect(page.getByTestId('help-panel')).toBeVisible();
            await page.waitForTimeout(800);
            await S('scorer', 'help');
          });
        } finally {
          await context.close();
        }
        // The installed app without a session asks for the pairing code.
        const fresh = await newPage(browser, dev, lang);
        try {
          await fresh.page.addInitScript((l) => localStorage.setItem('cc.scorerLocale', l), lang);
          await fresh.page.goto('/p/app');
          await expect(fresh.page.getByTestId('scorer-pair')).toBeVisible();
          await shot(fresh.page, { area: 'superSpeakers', page: 'scorer', state: 'pairing-entry-installed-app', dev, lang });
          await fresh.page.goto('/p#ux-not-a-real-link-token-00000000000000000000');
          await fresh.page.waitForTimeout(1500);
          await shot(fresh.page, { area: 'superSpeakers', page: 'scorer', state: 'link-gone', dev, lang });
        } finally {
          await fresh.context.close();
        }
      });
    }

    // ---------------------------------------------------------------- board
    const boardRuns: Array<[Device, Locale, string]> = [
      [DEV.desktop, 'en', DEFAULT_THEME],
      [DEV.display720, 'en', DEFAULT_THEME],
      [DEV.display4k, 'en', DEFAULT_THEME],
      [DEV.desktop, 'tr', DEFAULT_THEME],
      [DEV.display720, 'tr', DEFAULT_THEME],
      ...OTHER_THEMES.flatMap((t): Array<[Device, Locale, string]> => [
        [DEV.desktop, 'en', t],
        [DEV.display720, 'en', t],
      ]),
    ];
    for (const [dev, lang, theme] of boardRuns) {
      await step(`board ${dev.name} ${lang} ${theme}`, async () => {
        if (!boardUrl) throw new Error('no board link in the demo school');
        expect((await api(ap, 'PUT', '/api/admin/speakers/settings', { boardLanguage: lang, theme })).status).toBe(200);
        for (const placeholder of [false, true]) {
          const { context, page } = await newPage(browser, dev, lang);
          try {
            if (placeholder) {
              await page.route('**/api/board', async (route) => {
                const res = await route.fetch();
                const body = (await res.json()) as Record<string, unknown>;
                await route.fulfill({ response: res, json: { ...body, places: [] } });
              });
            }
            await page.goto(boardUrl);
            await expect(page.getByTestId('board')).toBeVisible();
            await page.waitForTimeout(2500);
            const isPlaceholder = (await page.getByTestId('board-placeholder').count()) > 0;
            if (!placeholder && isPlaceholder) miss(`board podium: the demo week has no points, the board shows the placeholder ${dev.name} ${lang} ${theme}`);
            await shot(page, { area: 'superSpeakers', page: 'board', state: isPlaceholder ? (placeholder ? 'placeholder' : 'placeholder-live') : 'podium', dev, lang, theme });
          } finally {
            await context.close();
          }
        }
      });
    }
  } finally {
    await api(ap, 'PUT', '/api/admin/speakers/settings', { boardLanguage: before.settings.boardLanguage, theme: before.settings.theme });
    await admin.context.close();
  }
});

// ================================================================== AI tools (switched on only here)
test('AI tools pages and the consent page', async ({ browser }) => {
  const admin = await signIn(browser, 'admin');
  const ap = admin.page;
  const before = (await api(ap, 'GET', '/api/admin/ai-tools')).body.settings as { mcpEnabled: boolean; aiStudentDataAllowed: boolean };
  const CALLBACK = 'http://127.0.0.1:47123/callback';
  try {
    expect((await api(ap, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    const origin = new URL(ap.url()).origin;
    // One personal token, so Profile and Admin list one (its secret is shown only once, in the dialog).
    const teacher = await signIn(browser, 'english');
    await ensurePin(teacher.page);
    const tok = await api(teacher.page, 'POST', '/api/account/ai-tools/tokens', { name: 'Lesson planning (UX)', scopes: ['classes:read', 'reports:read'], days: 7, currentPassword: PASSWORD });
    if (tok.status !== 200) miss('AI tools: the example token could not be made', tok.status);
    const reg = await ap.request.post('/oauth/register', { headers: { 'content-type': 'application/json' }, data: JSON.stringify({ client_name: 'Example AI app (UX)', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }) });
    const clientId = reg.status() === 201 ? ((await reg.json()) as { client_id: string }).client_id : null;
    if (!clientId) miss('AI tools: the example app could not register', reg.status());
    try {
      for (const lang of ['en', 'tr'] as const) {
        await setLocale(ap, lang);
        await setLocale(teacher.page, lang);
        for (const [dev, l] of OFFICE_RUNS.filter(([, x]) => x === lang)) {
          const where = `${dev.name} ${l}`;
          await step(`admin/ai-tools switched on ${where}`, async () => {
            const { context, page } = await newPage(browser, dev, l, { storageState: await admin.context.storageState() });
            try {
              await page.goto('/admin/ai-tools');
              await expect(page.getByTestId('admin-ai-tools')).toBeVisible();
              await page.waitForTimeout(600);
              await shot(page, { area: 'admin', page: 'ai-tools', state: 'switched-on', dev, lang: l });
            } finally {
              await context.close();
            }
          });
          const { context, page } = await newPage(browser, dev, l, { storageState: await teacher.context.storageState() });
          try {
            await step(`teacher/profile AI tools ${where}`, async () => {
              await page.goto('/teacher/profile');
              const section = page.getByTestId('ai-tools');
              await expect(section).toBeVisible();
              await section.scrollIntoViewIfNeeded();
              await shot(page, { area: 'teacher', page: 'profile', state: 'ai-tools-on', dev, lang: l });
            });
            await step(`oauth consent ${where}`, async () => {
              if (!clientId) throw new Error('no registered app');
              await page.route('http://127.0.0.1:47123/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Back in the app.' }));
              const challenge = 'x'.repeat(43);
              const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: `ux-${l}`, resource: `${origin}/mcp`, scope: 'classes:read reports:read' });
              await page.goto(`/oauth/authorize?${q.toString()}`);
              await expect(page).toHaveURL(/\/oauth\/consent\?request=/u);
              await expect(page.getByTestId('oauth-consent')).toBeVisible();
              await shot(page, { area: 'auth', page: 'oauth-consent', state: 'default', dev, lang: l });
              cover('/oauth/consent');
            });
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await setLocale(teacher.page, 'en');
      await teacher.context.close();
    }
  } finally {
    await setLocale(ap, 'en');
    // Switching AI tools off also ends every OAuth connection and waiting request (D-160).
    await api(ap, 'PUT', '/api/admin/ai-tools', { mcpEnabled: before.mcpEnabled, aiStudentDataAllowed: before.aiStudentDataAllowed });
    await admin.context.close();
  }
});

// ================================================================== coverage
test('every route of the client router was captured', async () => {
  // Routes reached only as a redirect or a parameter template.
  const implicit = new Set(['/', '/teacher', '$page']);
  const all = [...ROOT_PATHS.filter((p) => !implicit.has(p) && p !== '/admin' && p !== '/teacher'), ...TEACHER_PATHS.map((p) => `/teacher/${p}`), ...ADMIN_PATHS.map((p) => `/admin/${p}`.replace(/\/$/u, ''))];
  const shots = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'));
  const has = (area: string, pg: string) => shots.some((f) => f.startsWith(`${area}__${slug(pg)}__`));
  for (const r of all) {
    let ok = covered.has(r);
    // Each test runs in this worker, but a check by file name also works after a worker restart.
    if (!ok && r.startsWith('/teacher/')) ok = has('teacher', r.slice(9));
    if (!ok && r.startsWith('/admin')) ok = has('admin', r.slice(7) || 'home');
    if (!ok && r === '/classroom') ok = shots.some((f) => f.startsWith('classroom__'));
    if (!ok && ['/login', '/reset-password', '/invite', '/signin-link', '/change-password'].includes(r)) ok = has('auth', r.slice(1));
    if (!ok && r === '/help') ok = shots.some((f) => f.startsWith('help__guide-'));
    if (!ok && r === '/dev/catalog') ok = has('help', 'dev-catalog');
    if (!ok) miss(`route not captured: ${r}`);
  }
  // The student page, scorer and board are separate entries (student.html, scorer.html, board.html).
  for (const [area, pg] of [
    ['student', 'page'],
    ['superSpeakers', 'scorer'],
    ['superSpeakers', 'board'],
  ] as const) {
    if (!has(area, pg)) miss(`entry not captured: ${area}/${pg}`);
  }
  console.log(`[usability] ${shots.length} screenshots in ${OUT}`);
  expect(shots.length).toBeGreaterThan(0);
});
