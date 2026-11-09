/**
 * The classroom board (S14b, D-148; replaces the S13a rail of D-103/D-139). Fictional demo data only;
 * every setting this file changes (modules, class theme, class language, density, layouts) is put back.
 * 1. Module combinations x themes (13 x 3) at 1920x1080: facts over the board's boxes (`[data-box]`):
 *    no horizontal page scroll, no two boxes overlap, no empty or overflowing box, and a module that
 *    is off has neither a box nor a dock button. Screenshots go to test-results/layout/.
 * 2. Fit with the per-student reminder boxes on (the default since D-143): all 19 cards of 3-A on
 *    screen at Normal on 1440x900 and at every width from 1440 up (D-103), and every routine chip,
 *    End lesson, Attendance, the timer's Start and the class counter fully in view at every listed
 *    display, 1280x720 included (D-139). This closes the S14a "known gap" (D-143). The same holds
 *    with Turkish as the class language (longer stage names and counter words, D-099).
 * 2b. Short displays (S14i review) at 1280x720, 1366x768 and 1920x1080, English and Turkish: no name
 *    is split inside a word at Compact, Normal or Large; when the student grid cuts a row, "N more
 *    students below" is shown and scrolls to them; at 1280x720 the layout editor's handles and "Move to
 *    lesson tools" buttons above the grid are not hidden under the lesson tools tray.
 * 3. Compact / Normal / Large on this device; the timer keypad; the assistant panel in the dock (hide
 *    and show for this lesson); the class language mode.
 * 4. Customise layout: PIN dialog, keyboard and mouse edits, "Put in dock" / "Show as a box", resize,
 *    save for this class (kept after a reload, the other classes unchanged), the teacher area locked
 *    again after saving (423), "All my classes", Reset; axe on edit mode and on every dock view.
 */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, closeDock, ensurePin, login, openDock, PIN, type DockPanel } from './helpers.ts';

const MODULES = ['routines', 'attendance', 'counters', 'secretStudents', 'assistant', 'grouping', 'homework', 'goals', 'achievements'] as const;
type Module = (typeof MODULES)[number];
const THEMES = ['explorer', 'animals', 'classroom'] as const;
/** The board box (dashboard slot key) of each module that has one. */
const BOX_OF: Partial<Record<Module, string>> = { routines: 'routine', attendance: 'attendance', counters: 'counters', secretStudents: 'secret', assistant: 'assistant', grouping: 'groups', homework: 'homework', achievements: 'achievements' };

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
async function contexts(page: Page) {
  return (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
}
const context3A = async (page: Page) => (await contexts(page)).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;

type ModuleSetting = { module: string; enabled: boolean; config: Record<string, unknown> | null };
const modulesOf = async (page: Page, contextId: string) => (await api(page, 'GET', `/api/teacher/contexts/${contextId}/modules`)).body.modules as ModuleSetting[];

async function setModules(page: Page, contextId: string, on: readonly Module[], base: ModuleSetting[]) {
  for (const m of MODULES) {
    const cur = base.find((x) => x.module === m);
    const r = await api(page, 'PUT', `/api/teacher/contexts/${contextId}/modules/${m}`, { enabled: on.includes(m), config: cur?.config ?? null });
    expect(r.status, m).toBe(200);
  }
}

/** Per-student reminder boxes on the cards: on by default since S14a (D-143). Returns the previous setting. */
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

async function openClassroom(page: Page, cls = '3-A') {
  await page.goto('/classroom');
  await page.getByRole('button', { name: new RegExp(`${cls} · (English|İngilizce)`, 'u') }).first().click();
  await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
}

/**
 * The classroom display runs in its own browser context (its own session), so the teacher session that
 * changes settings through the API never enters classroom mode and needs no PIN unlock.
 */
async function displayPage(browser: Browser, viewport = { width: 1920, height: 1080 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true });
  const p = await ctx.newPage();
  await login(p, 'english');
  return { ctx, p };
}

async function axe(page: Page, selector: string) {
  const r = await new AxeBuilder({ page }).include(selector).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), selector).toEqual([]);
}

/** Facts measured over the board's boxes: page scroll, overlapping, empty, overflowing or off-screen boxes. */
async function layoutFacts(page: Page) {
  return page.evaluate(() => {
    const se = document.scrollingElement!;
    const boxes = [...document.querySelectorAll<HTMLElement>('[data-box]')].filter((b) => b.getClientRects().length > 0);
    const rects = boxes.map((b) => ({ key: b.dataset.box!, r: b.getBoundingClientRect() }));
    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i += 1)
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!.r;
        const b = rects[j]!.r;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) overlaps.push(`${rects[i]!.key} / ${rects[j]!.key}`);
      }
    const empty = boxes.filter((b) => b.getBoundingClientRect().height < 4 || !b.innerText.trim()).map((b) => b.dataset.box);
    const overflowing = boxes.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.dataset.box);
    const offScreen = rects.filter(({ r }) => r.left < -1 || r.right > window.innerWidth + 1).map(({ key }) => key);
    return { hScroll: se.scrollWidth > se.clientWidth + 1, overlaps, empty, overflowing, offScreen };
  });
}

const VIEWPORTS: Array<{ name: string; width: number; height: number; scale: number }> = [
  { name: '1280x720', width: 1280, height: 720, scale: 1 },
  { name: '1280x800', width: 1280, height: 800, scale: 1 },
  { name: '1366x768', width: 1366, height: 768, scale: 1 },
  { name: '1440x900', width: 1440, height: 900, scale: 2 },
  { name: '1470x956', width: 1470, height: 956, scale: 2 },
  { name: '1920x1080', width: 1920, height: 1080, scale: 1 },
  { name: '2560x1440', width: 2560, height: 1440, scale: 1 },
  // A 3840x2160 (4K) display at 150% and 200% operating-system scaling.
  { name: '4k-150', width: 2560, height: 1440, scale: 1.5 },
  { name: '4k-200', width: 1920, height: 1080, scale: 2 },
];

/** Cards fully on screen: inside the window AND inside the student grid's scroll box (not hidden under it). */
async function cardsOnScreen(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
    return [...document.querySelectorAll('.cc-student-card')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= Math.max(0, box.top) - 0.5 && r.bottom <= Math.min(window.innerHeight, box.bottom) + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    }).length;
  });
}

async function onDevice(browser: Browser, page: Page, vp: (typeof VIEWPORTS)[number]) {
  const ctx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale, hasTouch: true });
  return { ctx, p: await ctx.newPage() };
}

test('module combinations x themes: the board holds (no overlap, no empty box, no horizontal scroll, no box of a module that is off)', async ({ page, browser }) => {
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
    ...MODULES.map((m): [string, readonly Module[]] => [`without-${m}`, MODULES.filter((x) => x !== m)]),
  ];
  expect(combos).toHaveLength(13);
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
        await expect(d.getByRole('button', { name: 'End lesson', exact: true })).toBeInViewport({ ratio: 1 });
        const facts = await layoutFacts(d);
        await d.screenshot({ path: `test-results/layout/${name}-${theme}.png` });
        expect(facts, `${name} / ${theme}`).toEqual({ hScroll: false, overlaps: [], empty: [], overflowing: [], offScreen: [] });
        // A module that is off leaves neither a box nor a dock button.
        for (const m of MODULES) {
          const key = BOX_OF[m];
          if (!key || on.includes(m)) continue;
          await expect(d.locator(`[data-box="${key}"]`), `${name}: ${key}`).toHaveCount(0);
          await expect(d.getByTestId(`dock-${key}`), `${name}: dock ${key}`).toHaveCount(0);
        }
        if (name === 'all-off') {
          // The timer, the student grid, today's focus and the dock with End lesson remain.
          expect(await d.locator('[data-box]').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => (e as HTMLElement).dataset.box).sort())).toEqual(['core.dock', 'core.students', 'core.timer', 'focus']);
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

/** The board's button names in the class language. */
const BOARD_LABELS = {
  en: { next: 'Next stage', start: 'Start', attendance: 'Attendance', end: 'End lesson' },
  tr: { next: 'Sonraki aşama', start: 'Başlat', attendance: 'Yoklama', end: 'Dersi bitir' },
} as const;

test('fit (D-103, D-139 with D-143): with the reminder boxes on, 19 cards at Normal from 1440x900 up, and the routine, timer Start, counter, Attendance and End lesson in view everywhere, in English and Turkish', async ({ page, browser }) => {
  test.setTimeout(420_000);
  mkdirSync('test-results/fit', { recursive: true });
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const original = await modulesOf(page, ctx.id);
  // Settings go through a second session: the display devices share `page`'s session, which is in
  // classroom mode (PIN-locked for teacher-area calls) once the classroom is open.
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  try {
    await setModules(office, ctx.id, MODULES, original);
    await setReminderBoxes(office, ctx.id, true);
    await startLesson(page, ctx.id);
    // Below 1440 the grid scrolls inside its box; these floors keep it from getting worse (measured
    // 2026-11-09 with the board: 14 at 1366x768 and 1280x720, 12 at 1280x800 where the larger text
    // leaves room for six columns instead of seven).
    const FLOOR: Record<string, number> = { '1280x720': 14, '1280x800': 12, '1366x768': 14 };
    const runs: Array<{ boxes: boolean; lang: 'en' | 'tr' }> = [
      { boxes: true, lang: 'en' },
      { boxes: false, lang: 'en' },
      { boxes: true, lang: 'tr' },
    ];
    for (const { boxes, lang } of runs) {
      await setReminderBoxes(office, ctx.id, boxes);
      expect((await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
      const L = BOARD_LABELS[lang];
      for (const vp of VIEWPORTS) {
        const run = `${vp.name}${lang === 'en' ? '' : ` ${lang}`}`;
        const { ctx: c, p } = await onDevice(browser, page, vp);
        try {
          await openClassroom(p);
          await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'normal');
          await expect(p.getByRole('button', { name: L.end, exact: true })).toBeVisible();
          await expect(p.locator('.cc-student-card')).toHaveCount(19);
          if (boxes) await expect(p.locator('.cc-student-card__add').first()).toBeVisible();
          const facts = await layoutFacts(p);
          await p.screenshot({ path: `test-results/fit/${vp.name}-normal${boxes ? '-boxes' : ''}${lang === 'en' ? '' : `-${lang}`}.png` });
          expect(facts.hScroll, run).toBe(false);
          expect(facts.overlaps, run).toEqual([]);
          // Everything but the student grid is on screen without scrolling (D-139, D-148).
          const chips = p.getByTestId('routine-stages').getByRole('listitem');
          await expect(chips).toHaveCount(6);
          for (let i = 0; i < 6; i += 1) await expect(chips.nth(i), `${run}: stage ${i + 1}`).toBeInViewport({ ratio: 1 });
          await expect(p.getByRole('button', { name: L.next }), run).toBeInViewport({ ratio: 1 });
          await expect(p.getByTestId('timer').getByRole('button', { name: L.start, exact: true }), run).toBeInViewport({ ratio: 1 });
          await expect(p.getByTestId('counter-bar').first(), run).toBeInViewport({ ratio: 1 });
          await expect(p.getByRole('button', { name: L.attendance, exact: true }), run).toBeInViewport({ ratio: 1 });
          await expect(p.getByRole('button', { name: L.end, exact: true }), run).toBeInViewport({ ratio: 1 });
          // The top bar is one row (the quote of the day stays on it from 1200 px), not three.
          const bar = await p.locator('.cc-classroom-bar').evaluate((e) => e.getBoundingClientRect().height);
          expect(bar, `${run}: top bar height`).toBeLessThan(vp.height * 0.15);
          const visible = await cardsOnScreen(p);
          test.info().annotations.push({ type: 'cards on screen', description: `${run}${boxes ? ' with reminder boxes' : ''}: ${visible}` });
          if (vp.width >= 1440) expect(visible, `${run}: cards on screen${boxes ? ' with reminder boxes' : ''}`).toBe(19);
          else expect(visible, `${run}: cards on screen`).toBeGreaterThanOrEqual(FLOOR[vp.name] ?? 0);
        } finally {
          await c.close();
        }
      }
    }
    await setReminderBoxes(office, ctx.id, true);
    expect((await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false })).status).toBe(200);

    // Compact / Normal / Large on this device: the cards change size and the choice survives a reload.
    const { ctx: c, p } = await onDevice(browser, page, VIEWPORTS[3]!);
    try {
      await openClassroom(p);
      const size = () => p.locator('.cc-student-card').first().evaluate((e) => e.getBoundingClientRect().width * e.getBoundingClientRect().height);
      const normal = await size();
      const control = p.getByTestId('density-control');
      const openSettings = async () => {
        if (!(await control.isVisible())) await p.getByTestId('classroom-settings').click();
      };
      await openSettings();
      await control.getByRole('button', { name: 'Large' }).click();
      await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'large');
      await expect.poll(size).toBeGreaterThan(normal);
      await p.reload();
      await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', 'large');
      await openSettings();
      await control.getByRole('button', { name: 'Compact' }).click();
      await expect.poll(size).toBeLessThan(normal);
      expect((await layoutFacts(p)).hScroll).toBe(false);
      await openSettings();
      await control.getByRole('button', { name: 'Normal' }).click();
      await expect(control.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await c.close();
    }
  } finally {
    // The device contexts shared this session; it is not used again, so no PIN unlock.
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false });
    for (const m of original) await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/${m.module}`, { enabled: m.enabled, config: m.config });
    await officeCtx.close();
  }
});

/** Names on the cards whose words are split over two lines ("Şimşe / k"): each word must be one piece. */
async function splitNames(page: Page) {
  return page.locator('.cc-student-card__name-text').evaluateAll((els) =>
    els.flatMap((el) => {
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return [];
      const text = node.textContent ?? '';
      const out: string[] = [];
      for (const m of text.matchAll(/\S+/gu)) {
        const r = document.createRange();
        r.setStart(node, m.index!);
        r.setEnd(node, m.index! + m[0].length);
        const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
        if (tops.size > 1) out.push(`${text}: ${m[0]}`);
      }
      return out;
    }),
  );
}

test('short displays (S14i review): names never split inside a word at any size, a cut student row shows how many are below, editor controls in view', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  try {
    await startLesson(page, ctx.id);
    for (const lang of ['en', 'tr'] as const) {
      expect((await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
      for (const vp of VIEWPORTS.filter((v) => ['1280x720', '1366x768', '1920x1080'].includes(v.name))) {
        const { ctx: c, p } = await onDevice(browser, page, vp);
        try {
          await openClassroom(p);
          await expect(p.locator('.cc-student-card')).toHaveCount(19);
          for (const size of [/^(Compact|Küçük)$/u, /^(Large|Büyük)$/u, /^Normal$/u]) {
            if (!(await p.getByTestId('density-control').isVisible())) await p.getByTestId('classroom-settings').click();
            await p.getByTestId('density-control').getByRole('button', { name: size }).click();
            await p.keyboard.press('Escape');
            await p.waitForTimeout(300);
            expect(await splitNames(p), `${vp.name} ${lang} ${size}`).toEqual([]);
          }
          // Normal: when a row is cut, the cue says how many children are below and scrolls to them.
          const visible = await cardsOnScreen(p);
          const more = p.getByTestId('students-more');
          if (visible < 19) {
            await expect(more, `${vp.name} ${lang}`).toBeVisible();
            await expect(more).toContainText(String(19 - visible));
            // One or two presses bring the last card fully into the box; then the cue goes away.
            for (let i = 0; i < 3 && (await more.count()); i += 1) {
              await more.click();
              await p.waitForTimeout(500);
            }
            await expect(more).toHaveCount(0);
            const lastShown = await p.evaluate(() => {
              const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
              const cards = document.querySelectorAll('.cc-student-card');
              return cards[cards.length - 1]!.getBoundingClientRect().bottom <= Math.min(box.bottom, window.innerHeight) + 1;
            });
            expect(lastShown, `${vp.name} ${lang}: the last card in view`).toBe(true);
          } else await expect(more, `${vp.name} ${lang}`).toHaveCount(0);
          // The layout editor: the handle and "Move to lesson tools" of every box above the student grid
          // are in view and not under the lesson tools tray (a narrow box keeps its size for screen
          // readers only). The student grid's own frame is reached by scrolling the rows at this height
          // (a known gap, ROADMAP S14i).
          if (vp.name === '1280x720') {
            await p.getByTestId('classroom-settings').click();
            await p.getByTestId('customise-layout').click();
            const pin = p.getByTestId('pin-dialog').locator('input').first();
            await pin.fill(PIN);
            await pin.press('Enter');
            await expect(p.getByTestId('layout-editor')).toBeVisible();
            const hidden = await p.locator('[data-handle]:not([data-handle="core.students"]), [data-testid^="layout-to-dock-"]').evaluateAll((els) =>
              els
                .filter((e) => {
                  const r = e.getBoundingClientRect();
                  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  return r.bottom > window.innerHeight || r.right > window.innerWidth || !top || !(e === top || e.contains(top));
                })
                .map((e) => (e as HTMLElement).dataset.handle ?? (e as HTMLElement).dataset.testid),
            );
            expect(hidden, `${vp.name} ${lang}: editor controls out of view`).toEqual([]);
            await p.getByTestId('layout-editor').getByRole('button', { name: /^(Cancel|Vazgeç|İptal)$/u }).click();
            await expect(p.getByTestId('layout-editor')).toHaveCount(0);
          }
        } finally {
          await c.close();
        }
      }
    }
  } finally {
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false });
    await officeCtx.close();
  }
});

test('timer keypad, the assistant panel in the dock (hide/show), and the class language mode on the classroom screen', async ({ page, browser }) => {
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

    // Assistant panel (in the dock by default): duty ticks, hide for this lesson, show again.
    let view = await openDock(d, 'assistant');
    const assistant = view.getByTestId('assistant-panel');
    await expect(assistant).toBeVisible();
    if (await assistant.getByTestId('assistant-duties').count()) {
      const box = assistant.getByTestId('assistant-duties').getByRole('checkbox').first();
      await box.check();
      await closeDock(d, 'assistant');
      // The dock badge counts the duties done today.
      await expect(d.getByTestId('dock-assistant').locator('.cc-dock__badge')).toContainText('1 /');
      await d.reload();
      view = await openDock(d, 'assistant');
      await expect(view.getByTestId('assistant-duties').getByRole('checkbox').first()).toBeChecked();
    }
    await view.getByTestId('assistant-hide').click();
    await expect(view.getByTestId('assistant-panel')).toHaveCount(0);
    await closeDock(d, 'assistant');
    await d.reload();
    view = await openDock(d, 'assistant');
    await view.getByTestId('assistant-show').click();
    await expect(view.getByTestId('assistant-panel')).toBeVisible();
    await closeDock(d, 'assistant');

    // English only (the default): English labels, no language switch.
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'en');
    await expect(d.getByTestId('class-language-switch')).toHaveCount(0);

    // Turkish only: the classroom screen is in Turkish, still no switch.
    await setLanguage('tr', false);
    await openClassroom(d);
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'tr');
    await expect(d.getByTestId('class-language-switch')).toHaveCount(0);
    await expect(d.getByTestId('timer').getByRole('button', { name: 'Süre ayarla' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Dersi bitir', exact: true })).toBeInViewport({ ratio: 1 });

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

/** Box keys of each row of the board, as "key:w". */
const rowsOf = (p: Page) => p.locator('.cc-lesson-row:not([data-dock-row])').evaluateAll((els) => els.map((e) => [...e.querySelectorAll<HTMLElement>(':scope > .cc-lesson-box')].map((b) => `${b.dataset.box}:${b.dataset.w}`).join(' ')));
const dockOf = (p: Page) => p.getByTestId('lesson-dock').evaluate((e) => [...e.querySelectorAll<HTMLElement>('[data-testid^="dock-"]')].map((b) => b.dataset.testid!.slice(5)));

async function openEditor(p: Page) {
  await p.getByTestId('classroom-settings').click();
  await p.getByTestId('customise-layout').click();
  const dialog = p.getByTestId('pin-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Enter your PIN').fill(PIN);
  await dialog.getByLabel('Enter your PIN').press('Enter');
  await expect(p.getByTestId('layout-editor')).toBeVisible();
}

test('Customise layout: PIN, keyboard and mouse edits, save per class (relocks: 423), all my classes, reset; axe on edit mode and every dock view', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const all = await contexts(page);
  const ctxA = all.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  const ctxB = all.find((c) => c.id !== ctxA.id)!;
  const original = await modulesOf(page, ctxA.id);
  const { ctx: displayCtx, p: d } = await displayPage(browser, { width: 1440, height: 900 });
  const layoutOf = async (contextId: string) => (await api(d, 'GET', `/api/classroom/layout?contextId=${contextId}`)).body as { source: string; layout: unknown };
  try {
    await setModules(page, ctxA.id, MODULES, original);
    await startLesson(page, ctxA.id);
    await startLesson(page, ctxB.id);
    await openClassroom(d);

    // Every dock view: full screen, axe-clean, closes back to the board.
    for (const panel of ['assistant', 'secret', 'groups', 'homework', 'achievements'] as DockPanel[]) {
      await openDock(d, panel);
      await axe(d, `[data-testid="dock-view-${panel}"]`);
      await closeDock(d, panel);
    }

    // The editor needs the PIN; edit mode passes axe.
    await openEditor(d);
    await axe(d, '[data-testid="lesson-dashboard"]');
    expect(await rowsOf(d)).toEqual(['routine:8 core.timer:4', 'focus:4 counters:8', 'core.students:12']);

    // Keyboard: pick the timer up, move it left, put it down; Shift+arrows resize.
    const timerHandle = d.locator('[data-handle="core.timer"]');
    await timerHandle.focus();
    await d.keyboard.press('Enter');
    await expect(d.getByTestId('layout-announce')).toContainText('Timer picked up');
    await d.keyboard.press('ArrowLeft');
    await d.keyboard.press('Enter');
    await expect(d.getByTestId('layout-announce')).toHaveText('Timer put down.');
    await expect(d.locator('[data-handle="core.timer"]')).toBeFocused();
    await d.keyboard.press('Shift+ArrowRight');
    expect((await rowsOf(d))[0]).toBe('core.timer:5 routine:7');
    // Escape cancels a move that was not put down.
    await d.keyboard.press('Enter');
    await d.keyboard.press('ArrowDown');
    expect((await rowsOf(d))[0]).toBe('routine:12');
    await d.keyboard.press('Escape');
    expect((await rowsOf(d))[0]).toBe('core.timer:5 routine:7');

    // Mouse: drag the counter's handle onto the dock; "Show as a box" brings groups onto the board.
    const handle = d.locator('[data-handle="counters"]');
    const from = (await handle.boundingBox())!;
    const dock = (await d.getByTestId('layout-dock').boundingBox())!;
    await d.mouse.move(from.x + 12, from.y + 12);
    await d.mouse.down();
    await d.mouse.move(from.x + 40, from.y + 60, { steps: 4 });
    await d.mouse.move(dock.x + dock.width / 2, dock.y + dock.height / 2, { steps: 8 });
    await d.mouse.up();
    await expect(d.locator('[data-dock-item="counters"]')).toHaveCount(1);
    await d.getByTestId('layout-from-dock-groups').click();
    // Width by the splitter: drag the timer's right edge a few columns to the left.
    const split = d.getByTestId('layout-wsplit-core.timer');
    const sb = (await split.boundingBox())!;
    await d.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await d.mouse.down();
    await d.mouse.move(sb.x - 200, sb.y + sb.height / 2, { steps: 6 });
    await d.mouse.up();
    const edited = await rowsOf(d);
    expect(edited[0]).toMatch(/^core\.timer:[34] routine:(8|9)$/u);
    expect(edited.join(' ')).toContain('groups:');
    expect(edited.join(' ')).not.toContain('counters:');
    // Undo goes back one step at a time.
    await d.getByTestId('layout-editor').getByRole('button', { name: 'Undo' }).click();
    expect((await rowsOf(d))[0]).toBe('core.timer:5 routine:7');
    await d.getByTestId('layout-editor').getByRole('button', { name: 'Undo' }).click();
    expect((await rowsOf(d)).join(' ')).not.toContain('groups:');

    // Save for this class: the editor closes, the teacher area is locked again (423), the layout stays.
    await d.getByTestId('layout-save').click();
    await expect(d.getByTestId('layout-editor')).toHaveCount(0);
    await expect(d.getByTestId('toast').filter({ hasText: 'Layout saved for this class' })).toBeVisible();
    expect((await api(d, 'PUT', '/api/teacher/classroom-layout', { contextId: ctxA.id, applyTo: 'class', layout: {} })).status).toBe(423);
    const saved = await rowsOf(d);
    expect(saved[0]).toBe('core.timer:5 routine:7');
    expect(await dockOf(d)).toContain('counters');
    await d.reload();
    await expect(d.getByTestId('lesson-dashboard')).toBeVisible();
    expect(await rowsOf(d)).toEqual(saved);
    expect((await layoutOf(ctxA.id)).source).toBe('class');
    // Another class keeps the default.
    expect((await layoutOf(ctxB.id)).source).toBe('default');

    // All my classes: the other class shows it too.
    await openEditor(d);
    await d.getByTestId('layout-scope').getByRole('button', { name: 'All my classes' }).click();
    await d.getByTestId('layout-save').click();
    await expect(d.getByTestId('layout-editor')).toHaveCount(0);
    expect((await layoutOf(ctxB.id)).source).toBe('all');
    await openClassroom(d, ctxB.className);
    expect((await rowsOf(d))[0]).toBe('core.timer:5 routine:7');

    // Reset (all my classes, after a confirmation): the default board everywhere, locked again.
    await openEditor(d);
    await d.getByTestId('layout-scope').getByRole('button', { name: 'All my classes' }).click();
    await d.getByTestId('layout-editor').getByRole('button', { name: 'Reset' }).click();
    await d.getByTestId('layout-reset-confirm').click();
    await expect(d.getByTestId('layout-editor')).toHaveCount(0);
    expect((await layoutOf(ctxA.id)).source).toBe('default');
    expect((await layoutOf(ctxB.id)).source).toBe('default');
    expect((await rowsOf(d))[0]).toBe('routine:8 core.timer:4');
    expect((await api(d, 'DELETE', '/api/teacher/classroom-layout', { contextId: ctxA.id, applyTo: 'all' })).status).toBe(423);

    // Cancel also locks again and keeps nothing.
    await openEditor(d);
    await d.locator('[data-handle="core.timer"]').focus();
    await d.keyboard.press('Shift+ArrowRight');
    await d.getByTestId('layout-editor').getByRole('button', { name: 'Cancel' }).click();
    await expect(d.getByTestId('layout-editor')).toHaveCount(0);
    expect((await rowsOf(d))[0]).toBe('routine:8 core.timer:4');
    expect((await api(d, 'DELETE', '/api/teacher/classroom-layout', { contextId: ctxA.id, applyTo: 'all' })).status).toBe(423);
  } finally {
    // Only after a failure is a layout left behind (PIN unlocks are rate-limited: no unlock otherwise).
    if ((await layoutOf(ctxA.id)).source !== 'default' || (await layoutOf(ctxB.id)).source !== 'default') {
      await api(d, 'POST', '/api/auth/pin/unlock', { pin: PIN });
      await api(d, 'DELETE', '/api/teacher/classroom-layout', { contextId: ctxA.id, applyTo: 'all' });
      await api(d, 'POST', '/api/auth/lock');
    }
    await endActiveLessons(page);
    for (const m of original) await api(page, 'PUT', `/api/teacher/contexts/${ctxA.id}/modules/${m.module}`, { enabled: m.enabled, config: m.config });
    await displayCtx.close();
  }
});
