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
 * 4. Usability pass (D-139): End lesson and the class counter are on screen without scrolling at
 *    1920x1080 and 1280x720; size, language and sounds are in the top bar's Display popover.
 * 5. Known gap until S14b: with the reminder boxes on (the default since D-143) D-139 and D-103 are not
 *    met yet; a test pins that and tells S14b to turn it into a normal guard.
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

/** Per-student reminder boxes on the cards: on by default since S14a (D-143). Returns the previous config. */
async function setReminderBoxes(page: Page, contextId: string, on: boolean) {
  const m = (await modulesOf(page, contextId)).find((x) => x.module === 'counters')!;
  const r = await api(page, 'PUT', `/api/teacher/contexts/${contextId}/modules/counters`, { enabled: m.enabled, config: { ...(m.config ?? {}), showReminderBoxes: on } });
  expect(r.status).toBe(200);
  return m;
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
    // The module panels sit in their own grid under the student cards (D-139): each panel is a block.
    const blocks = [...document.querySelectorAll('[data-testid="lesson-rail"] > *, .cc-lesson-layout__main > :not(.cc-lesson-panels), .cc-lesson-panels > *')] as HTMLElement[];
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
  // Settings go through a second session: the display devices share `page`'s session, which is in
  // classroom mode (PIN-locked for teacher-area calls) once the classroom is open.
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  const counters = await setReminderBoxes(office, ctx.id, false);
  await startLesson(page, ctx.id);
  try {
    // The owner's target (D-103): 18-20 students without scrolling at Normal on a 1440x900 laptop,
    // measured with the cards as they were then (no per-student boxes). Since S14a the boxes are on by
    // default (D-143) and make each card taller: the second pass re-measures with them. The 18-20
    // target with the boxes on comes with the full-width grid of S14b (D-148).
    // Measured 2026-11-09 with the boxes on: 16 at 1440x900 and 1470x956, 12 at 1366x768 and 1280x800,
    // all 19 from 1920x1080 up. These floors only stop the default (boxes on) from getting worse; the
    // D-103 target itself is an open S14b item, and the test below that is expected to fail tracks it.
    const BOXES_ON_FLOOR: Record<string, number> = { '1440x900': 16, '1470x956': 16, '1366x768': 12, '1280x800': 12, '1920x1080': 19, '2560x1440': 19 };
    for (const boxes of [false, true]) {
      await setReminderBoxes(office, ctx.id, boxes);
      for (const vp of VIEWPORTS) {
        const { ctx: c, p } = await onDevice(browser, page, vp);
        try {
          await openClassroom(p);
          await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'normal');
          await expect(p.locator('.cc-student-card')).toHaveCount(19);
          if (boxes) await expect(p.locator('.cc-student-card__add').first()).toBeVisible();
          const facts = await layoutFacts(p);
          await p.screenshot({ path: `test-results/fit/${vp.name}-normal${boxes ? '-boxes' : ''}.png` });
          expect(facts.hScroll, vp.name).toBe(false);
          expect(facts.overlap, vp.name).toBe(false);
          const visible = await cardsOnScreen(p);
          test.info().annotations.push({ type: 'cards on screen', description: `${vp.name}${boxes ? ' with reminder boxes' : ''}: ${visible}` });
          if (!boxes && (vp.name === '1440x900' || vp.width >= 1440)) expect(visible, `${vp.name}: cards on screen`).toBe(19);
          if (boxes && BOXES_ON_FLOOR[vp.name]) expect(visible, `${vp.name}: cards on screen with reminder boxes`).toBeGreaterThanOrEqual(BOXES_ON_FLOOR[vp.name]!);
        } finally {
          await c.close();
        }
      }
    }
    await setReminderBoxes(office, ctx.id, false);

    // Compact / Normal / Large on this device: the cards change size and the choice survives a reload.
    const { ctx: c, p } = await onDevice(browser, page, VIEWPORTS[0]!);
    try {
      await openClassroom(p);
      const size = () => p.locator('.cc-student-card').first().evaluate((e) => e.getBoundingClientRect().height);
      const normal = await size();
      const control = p.getByTestId('density-control');
      const openSettings = async () => {
        if (!(await control.isVisible())) await p.getByTestId('classroom-settings').click();
      };
      await openSettings();
      await control.getByRole('button', { name: 'Large' }).click();
      await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'large');
      await expect.poll(size).toBeGreaterThan(normal);
      await p.screenshot({ path: 'test-results/fit/1440x900-large.png' });
      await p.reload();
      await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'large');
      await openSettings();
      await control.getByRole('button', { name: 'Compact' }).click();
      await expect.poll(size).toBeLessThan(normal);
      expect((await layoutFacts(p)).hScroll).toBe(false);
      await p.screenshot({ path: 'test-results/fit/1440x900-compact.png' });
      await openSettings();
      await control.getByRole('button', { name: 'Normal' }).click();
      await expect(control.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await c.close();
    }
  } finally {
    // The device contexts shared this session; it is not used again, so no PIN unlock (rate-limited).
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/counters`, { enabled: counters.enabled, config: counters.config });
    await officeCtx.close();
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
    await expect(d.getByTestId('class-language-switch')).toHaveCount(0);
    await d.getByTestId('classroom-settings').click();
    const sw = d.getByTestId('class-language-switch');
    await expect(sw).toBeVisible();
    await sw.getByRole('button', { name: 'Türkçe' }).click();
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'tr');
    if (!(await sw.isVisible())) await d.getByTestId('classroom-settings').click();
    await sw.getByRole('button', { name: 'English' }).click();
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'en');
  } finally {
    await endActiveLessons(page);
    await setLanguage('en', false);
    await displayCtx.close();
  }
});

/**
 * Known gap for S14b (S14a review): the default classroom (reminder boxes on since D-143) does not yet
 * meet D-139 at 1280x720 (the class bar is under the fold) or D-103 at 1440x900 (16 of 19 cards). This
 * test measures those targets on the default layout, so the gap cannot hide behind a non-default
 * setting. It pins the gap rather than skipping it (a `test.fail` would also swallow a broken page):
 * the page must load and the targets must still be missed. Once S14b's board (D-148) meets them, the
 * last assertion fails with a message saying so, and S14b changes it to `expect(failures).toEqual([])`.
 */
test('known gap until S14b (D-139, D-103): the default layout with reminder boxes on keeps the class counter and all 19 cards on screen', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const original = await modulesOf(page, ctx.id);
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  try {
    await setModules(page, ctx.id, MODULES, original);
    await setReminderBoxes(office, ctx.id, true);
    await startLesson(page, ctx.id);
    const failures: string[] = [];
    for (const vp of [
      { name: '1280x720', width: 1280, height: 720, scale: 1 },
      { name: '1440x900', width: 1440, height: 900, scale: 2 },
    ]) {
      const { ctx: c, p } = await onDevice(browser, page, vp);
      try {
        await openClassroom(p);
        // The setup itself must hold, so a broken page never counts as the expected failure.
        await expect(p.locator('.cc-student-card')).toHaveCount(19);
        await expect(p.locator('.cc-student-card__add').first()).toBeVisible();
        await expect(p.getByTestId('lesson-rail').getByRole('button', { name: 'End lesson' }), vp.name).toBeInViewport({ ratio: 1 });
        const barInView = await p
          .getByTestId('counter-bar')
          .first()
          .evaluate((e) => {
            const r = e.getBoundingClientRect();
            return r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
          });
        if (!barInView) failures.push(`${vp.name}: class counter bar under the fold`);
        const visible = await cardsOnScreen(p);
        test.info().annotations.push({ type: 'known gap (S14b)', description: `${vp.name} with reminder boxes: ${visible} cards on screen, counter bar ${barInView ? 'in view' : 'under the fold'}` });
        if (vp.width >= 1440 && visible < 18) failures.push(`${vp.name}: ${visible} cards on screen (target 18-20)`);
      } finally {
        await c.close();
      }
    }
    // S14b: when this fails, the default layout meets D-139 and D-103: replace it with
    // `expect(failures, 'D-139/D-103 targets on the default layout').toEqual([])`.
    expect(failures.length, 'the S14a known gap is closed: make this test a normal guard (see the comment above it)').toBeGreaterThan(0);
  } finally {
    await endActiveLessons(page);
    for (const m of original) await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/${m.module}`, { enabled: m.enabled, config: m.config });
    await officeCtx.close();
  }
});

test('usability pass (D-139): End lesson and the class counter are on screen at 1920x1080 and 1280x720 without scrolling', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const original = await modulesOf(page, ctx.id);
  // A second session for settings (the display devices put `page`'s session in classroom mode).
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  try {
    await setModules(page, ctx.id, MODULES, original);
    // Checked without the per-student boxes (on by default since S14a, D-143): with them the cards are
    // taller and the class bar sits under the fold at 1280x720 until S14b moves it above the grid (D-148).
    // The default (boxes on) is measured by the "known gap until S14b" test above, which S14b turns green.
    await setReminderBoxes(office, ctx.id, false);
    await startLesson(page, ctx.id);
    for (const vp of [
      { name: '1920x1080', width: 1920, height: 1080, scale: 1 },
      { name: '1280x720', width: 1280, height: 720, scale: 1 },
    ]) {
      const { ctx: c, p } = await onDevice(browser, page, vp);
      try {
        await openClassroom(p);
        await expect(p.getByTestId('counter-bar').first()).toBeVisible();
        const end = p.getByTestId('lesson-rail').getByRole('button', { name: 'End lesson' });
        await expect(end, vp.name).toBeInViewport({ ratio: 1 });
        await expect(p.getByRole('button', { name: 'Attendance' }), vp.name).toBeInViewport({ ratio: 1 });
        await expect(p.getByTestId('counter-bar').first(), vp.name).toBeInViewport();
        // On a 1080p display the timer's Start is also visible without scrolling the rail.
        if (vp.height >= 1080) await expect(p.getByTestId('lesson-rail').getByRole('button', { name: 'Start', exact: true }), vp.name).toBeInViewport({ ratio: 1 });
        // The top bar is one row (plus the quote of the day on narrower displays), not three.
        const bar = await p.locator('.cc-classroom-bar').evaluate((e) => e.getBoundingClientRect().height);
        expect(bar, `${vp.name}: top bar height`).toBeLessThan(vp.height * 0.15);
        expect((await layoutFacts(p)).hScroll, vp.name).toBe(false);
        await p.screenshot({ path: `test-results/fit/${vp.name}-usability.png` });
      } finally {
        await c.close();
      }
    }
  } finally {
    await endActiveLessons(page);
    for (const m of original) await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/${m.module}`, { enabled: m.enabled, config: m.config });
    await officeCtx.close();
  }
});
