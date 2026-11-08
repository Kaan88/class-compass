/**
 * S13a classroom screen (feedback round 1, 2026-11-07). Fictional demo data only; every setting this
 * file changes (modules, class theme, class language, density) is put back afterwards.
 * 1. Bug 1b: the layout holds with modules switched off. A matrix of module combinations (all on, all
 *    off, counters only, groups+homework+assistant, and each module off on its own) x themes at
 *    1920x1080: no horizontal page scroll, the rail and the main area never overlap, and no empty
 *    panel is left behind. Screenshots go to test-results/layout/.
 * 2. Density and auto-fit (D-103): no horizontal scroll at 1440x900, 1470x956, 1366x768, 1280x800,
 *    1920x1080, 2560x1440 and a 4K display at 150% and 200% scaling; at Normal on 1440x900 all 19
 *    student cards of 3-A are on screen without scrolling. Compact/Normal/Large is kept per device.
 * 3. The timer keypad (mm:ss), the assistant panel hide/show, and the class language mode
 *    (Turkish-only and English-only show no switch; two languages show it).
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

const MODULES = ['routines', 'attendance', 'counters', 'secretStudents', 'assistant', 'grouping', 'homework', 'goals', 'achievements'] as const;
type Module = (typeof MODULES)[number];
const THEMES = ['explorer', 'animals', 'classroom'] as const;

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
}

type ModuleSetting = { module: string; enabled: boolean; config: Record<string, unknown> | null };
const modulesOf = async (page: Page, contextId: string) => (await api(page, 'GET', `/api/teacher/contexts/${contextId}/modules`)).body.modules as ModuleSetting[];

async function setModules(page: Page, contextId: string, on: readonly Module[], base: ModuleSetting[]) {
  for (const m of MODULES) {
    const cur = base.find((x) => x.module === m);
    const r = await api(page, 'PUT', `/api/teacher/contexts/${contextId}/modules/${m}`, { enabled: on.includes(m), config: cur?.config ?? null });
    expect(r.status, m).toBe(200);
  }
}

/**
 * The classroom display runs in its own browser context (its own session), so the teacher session that
 * changes settings through the API never enters classroom mode and needs no PIN unlock (rate-limited).
 */
async function displayPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true });
  const p = await ctx.newPage();
  await login(p, 'english');
  return { ctx, p };
}

async function startLesson(page: Page, contextId: string) {
  const r = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId, payload: { contextId, othersPresent: true, attendance: [] } }] });
  expect(r.body.results[0].ok).toBe(true);
}

async function openClassroom(page: Page) {
  await page.goto('/classroom');
  await page.getByRole('button', { name: /3-A · (English|İngilizce)/ }).first().click();
  await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
}

/** Layout facts measured in the page: horizontal scroll, rail/main overlap, empty or overflowing panels. */
async function layoutFacts(page: Page) {
  return page.evaluate(() => {
    const se = document.scrollingElement!;
    const rail = document.querySelector('[data-testid="lesson-rail"]')!.getBoundingClientRect();
    const main = document.querySelector('.cc-lesson-layout__main')!.getBoundingClientRect();
    const apart = rail.right <= main.left + 1 || main.right <= rail.left + 1 || rail.bottom <= main.top + 1 || main.bottom <= rail.top + 1;
    const blocks = [...document.querySelectorAll('[data-testid="lesson-rail"] > *, .cc-lesson-layout__main > *')] as HTMLElement[];
    const empty = blocks.filter((e) => e.getBoundingClientRect().height < 4 || !e.innerText.trim()).map((e) => e.className || e.tagName);
    const overflowing = blocks.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.tagName);
    return { hScroll: se.scrollWidth > se.clientWidth + 1, overlap: !apart, empty, overflowing };
  });
}

test('bug 1b: the classroom layout holds for module combinations x themes (no empty panels, no overlap, no horizontal scroll)', async ({ page, browser }) => {
  test.setTimeout(900_000);
  mkdirSync('test-results/layout', { recursive: true });
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const original = await modulesOf(page, ctx.id);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, 'admin');
  const classes = (await api(admin, 'GET', '/api/admin/classes')).body.classes as Array<{ id: string; name: string; theme: string }>;
  const originalTheme = classes.find((c) => c.id === ctx.classId)!.theme;
  const { ctx: displayCtx, p: d } = await displayPage(browser);
  const combos: Array<[string, readonly Module[]]> = [
    ['all-on', MODULES],
    ['all-off', []],
    ['counters-only', ['counters']],
    ['groups-homework-assistant', ['grouping', 'homework', 'assistant']],
    // Each module switched off on its own (bug 1b: "each one off").
    ...MODULES.map((m): [string, readonly Module[]] => [`without-${m}`, MODULES.filter((x) => x !== m)]),
  ];
  try {
    for (const theme of THEMES) {
      expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx.classId}`, { theme })).status).toBe(200);
      for (const [name, on] of combos) {
        await setModules(page, ctx.id, on, original);
        await startLesson(page, ctx.id);
        await openClassroom(d);
        await expect(d.locator('html')).toHaveAttribute('data-theme', theme);
        // "Today's focus" when the lesson has a topic, otherwise only the quiet "Choose a topic" action.
        await expect(d.getByTestId(/^todays-focus(-empty)?$/)).toBeVisible();
        const facts = await layoutFacts(d);
        await d.screenshot({ path: `test-results/layout/${name}-${theme}.png`, fullPage: true });
        expect(facts, `${name} / ${theme}`).toEqual({ hScroll: false, overlap: false, empty: [], overflowing: [] });
        // With every module off the rail still holds the timer and End Lesson, nothing else.
        if (name === 'all-off') {
          await expect(d.getByTestId('lesson-rail').locator('.cc-card')).toHaveCount(1);
          await expect(d.getByTestId('groups-panel')).toHaveCount(0);
        }
        await endActiveLessons(page);
      }
    }
  } finally {
    await endActiveLessons(page);
    await displayCtx.close();
    for (const m of original) await api(page, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/${m.module}`, { enabled: m.enabled, config: m.config });
    await api(admin, 'PATCH', `/api/admin/classes/${ctx.classId}`, { theme: originalTheme });
    await adminCtx.close();
  }
});

const VIEWPORTS: Array<{ name: string; width: number; height: number; scale: number }> = [
  { name: '1440x900', width: 1440, height: 900, scale: 2 },
  { name: '1470x956', width: 1470, height: 956, scale: 2 },
  { name: '1366x768', width: 1366, height: 768, scale: 1 },
  { name: '1280x800', width: 1280, height: 800, scale: 1 },
  { name: '1920x1080', width: 1920, height: 1080, scale: 1 },
  { name: '2560x1440', width: 2560, height: 1440, scale: 1 },
  // A 3840x2160 (4K) display at 150% and 200% operating-system scaling.
  { name: '4k-150', width: 2560, height: 1440, scale: 1.5 },
  { name: '4k-200', width: 1920, height: 1080, scale: 2 },
];

async function cardsOnScreen(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.cc-student-card')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    }).length,
  );
}

async function onDevice(browser: Browser, page: Page, vp: (typeof VIEWPORTS)[number]) {
  const ctx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale, hasTouch: true });
  return { ctx, p: await ctx.newPage() };
}

test('density and auto-fit: no horizontal scroll on common displays; 19 students fit at Normal on 1440x900', async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync('test-results/fit', { recursive: true });
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  await startLesson(page, ctx.id);
  try {
    for (const vp of VIEWPORTS) {
      const { ctx: c, p } = await onDevice(browser, page, vp);
      try {
        await openClassroom(p);
        await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'normal');
        await expect(p.locator('.cc-student-card')).toHaveCount(19);
        const facts = await layoutFacts(p);
        await p.screenshot({ path: `test-results/fit/${vp.name}-normal.png` });
        expect(facts.hScroll, vp.name).toBe(false);
        expect(facts.overlap, vp.name).toBe(false);
        const visible = await cardsOnScreen(p);
        // The owner's target (D-103): 18-20 students without scrolling at Normal on a 1440x900 laptop.
        if (vp.name === '1440x900' || vp.width >= 1440) expect(visible, `${vp.name}: cards on screen`).toBe(19);
      } finally {
        await c.close();
      }
    }

    // Compact / Normal / Large on this device: the cards change size and the choice survives a reload.
    const { ctx: c, p } = await onDevice(browser, page, VIEWPORTS[0]!);
    try {
      await openClassroom(p);
      const size = () => p.locator('.cc-student-card').first().evaluate((e) => e.getBoundingClientRect().height);
      const normal = await size();
      const control = p.getByTestId('density-control');
      await control.getByRole('button', { name: 'Large' }).click();
      await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'large');
      await expect.poll(size).toBeGreaterThan(normal);
      await p.screenshot({ path: 'test-results/fit/1440x900-large.png' });
      await p.reload();
      await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'large');
      await control.getByRole('button', { name: 'Compact' }).click();
      await expect.poll(size).toBeLessThan(normal);
      expect((await layoutFacts(p)).hScroll).toBe(false);
      await p.screenshot({ path: 'test-results/fit/1440x900-compact.png' });
      await control.getByRole('button', { name: 'Normal' }).click();
      await expect(control.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await c.close();
    }
  } finally {
    // The device contexts shared this session; it is not used again, so no PIN unlock (rate-limited).
    await endActiveLessons(page);
  }
});

test('timer keypad, assistant panel hide/show, and the class language mode on the classroom screen', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const { ctx: displayCtx, p: d } = await displayPage(browser);
  const setLanguage = async (mainLanguage: 'en' | 'tr', secondLanguageEnabled: boolean) => {
    expect((await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage, secondLanguageEnabled })).status).toBe(200);
  };
  try {
    await startLesson(page, ctx.id);
    await openClassroom(d);

    // Timer: any time with the big mm:ss keypad (1 3 0 → 01:30).
    const timer = d.getByTestId('timer');
    await timer.getByRole('button', { name: 'Set time' }).click();
    const keypad = d.getByTestId('timer-keypad');
    for (const k of ['1', '3', '0']) await keypad.getByRole('button', { name: k, exact: true }).click();
    await expect(keypad.getByTestId('timer-keypad-value')).toHaveText('01:30');
    await keypad.getByRole('button', { name: 'Delete the last digit' }).click();
    await expect(keypad.getByTestId('timer-keypad-value')).toHaveText('00:13');
    await keypad.getByRole('button', { name: '0', exact: true }).click();
    await keypad.getByRole('button', { name: 'Set time' }).click();
    await expect(keypad).toHaveCount(0);
    await expect(timer.getByTestId('timer-digits')).toContainText('1:30');

    // Assistant panel: hide for this lesson, show again (kept by the server across a reload).
    const assistant = d.getByTestId('assistant-panel');
    await expect(assistant).toBeVisible();
    if (await assistant.getByTestId('assistant-duties').count()) {
      const box = assistant.getByTestId('assistant-duties').getByRole('checkbox').first();
      await box.check();
      await d.reload();
      await expect(d.getByTestId('assistant-duties').getByRole('checkbox').first()).toBeChecked();
    }
    await d.getByTestId('assistant-hide').click();
    await expect(d.getByTestId('assistant-panel')).toHaveCount(0);
    await d.reload();
    await expect(d.getByTestId('assistant-show')).toBeVisible();
    await d.getByTestId('assistant-show').click();
    await expect(d.getByTestId('assistant-panel')).toBeVisible();

    // English only (the default): English labels, no language switch.
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'en');
    await expect(d.getByTestId('class-language-switch')).toHaveCount(0);

    // Turkish only: the classroom screen is in Turkish, still no switch.
    await setLanguage('tr', false);
    await openClassroom(d);
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'tr');
    await expect(d.getByTestId('class-language-switch')).toHaveCount(0);
    await expect(d.getByTestId('timer').getByRole('button', { name: 'Süre ayarla' })).toBeVisible();

    // Two languages: the switch is there and changes the screen language.
    await setLanguage('en', true);
    await openClassroom(d);
    const sw = d.getByTestId('class-language-switch');
    await expect(sw).toBeVisible();
    await sw.getByRole('button', { name: 'Türkçe' }).click();
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'tr');
    await sw.getByRole('button', { name: 'English' }).click();
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'en');
  } finally {
    await endActiveLessons(page);
    await setLanguage('en', false);
    await displayCtx.close();
  }
});
