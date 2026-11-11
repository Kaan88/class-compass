/**
 * S21b (D-174): nothing on the classroom screen covers anything else.
 * - Top bar: at 320, 375 and 414 px, at 100 % and 200 % text, in English and Turkish (class 3-A switched
 *   to Turkish only) and in all four themes (the three built-ins and the Snow Day example package), the
 *   class name, the subject, the date, the time, the quote and weather slots and the tools never
 *   intersect, the class name stays on one line, nothing is cut off or leaves the screen (S17b review:
 *   at 375 px "3-A" wrapped and "English" ran over the date line).
 * - Toasts: the "Lesson started" note after Start lesson never covers the dock or End lesson at 375 px,
 *   768×1024, 1536×703 at 1.25 and 1920×1080; every frame while the note shows is checked.
 * Fictional demo data only; the class theme and language, the imported package and the lesson are put
 * back in `finally` (the suite shares one database). The board's screen-size reports are not sent from these
 * many board openings: they are rate-limited per address and `e2e/display-info.spec.ts` checks them.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { QUOTES_EN, QUOTES_TR } from '../src/shared/quotes.ts';
import { THEME_KEYS } from '../src/shared/themes.ts';
import { api, ensurePin, login } from './helpers.ts';

const SNOW = readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', 'peppermint-snow-day.theme.json'), 'utf8');
const SNOW_KEY = 'peppermint-snow-day';
const SHOTS = 'test-results/s21b';

type Ctx = {
  id: string;
  classId: string;
  className: string;
  theme: string;
  chosenTheme: string;
  mainLanguage: 'en' | 'tr';
  secondLanguageEnabled: boolean;
  subjectName: { en: string };
};
const context3A = async (page: Page) => ((await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{
    contextId: string;
    lessonId: string;
  }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [
        {
          opId: randomUUID(),
          type: 'lesson.end',
          contextId: l.contextId,
          lessonId: l.lessonId,
          payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} },
        },
      ],
    });
  }
}

/** Opens the classroom screen on 3-A (the switcher names the class "3-A · English" or "3-A · İngilizce"). */
async function open3A(page: Page) {
  await page.goto('/classroom');
  await page
    .getByRole('button', { name: /^3-A · /u })
    .first()
    .click();
  await expect(page.getByTestId('class-banner-class')).toHaveText('3-A');
}

/** Everything wrong with the top bar's layout right now (empty when nothing overlaps). */
async function topBarProblems(page: Page, quote?: string): Promise<string[]> {
  return page.evaluate((quoteText) => {
    // The quote of the day depends on the class id and the date (random ids per run): the probe puts
    // the quotes with the longest words in its place for a moment and puts the day's quote back.
    const shown = document.querySelector('.cc-classroom-bar .cc-quote__text');
    const original = shown?.textContent ?? null;
    if (shown && quoteText !== undefined) shown.textContent = quoteText;
    try {
      return check();
    } finally {
      if (shown && quoteText !== undefined) shown.textContent = original;
    }
    function check() {
      const out: string[] = [];
      const bar = document.querySelector<HTMLElement>('.cc-classroom-bar')!;
      const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const items: Array<[string, Element]> = [];
      const add = (name: string, sel: string) => document.querySelectorAll(sel).forEach((el, i) => visible(el) && items.push([`${name}${i ? ` ${i}` : ''}`, el]));
      add('class name', '.cc-classroom-bar__name');
      add('subject', '.cc-classroom-bar__subject');
      add('date', '.cc-classroom-bar__date');
      add('time', '.cc-classroom-bar__time');
      add('quote', '.cc-classroom-bar .cc-topbar__slot--quote');
      add('weather', '.cc-classroom-bar .cc-topbar__slot--weather');
      bar.querySelectorAll('.cc-classroom-bar__tools > *').forEach((el) => visible(el) && items.push([`tool "${(el.textContent ?? '').trim().slice(0, 30)}"`, el]));
      /** The text's own boxes (an inline element that wraps covers only its lines, not the whole width). */
      const boxes = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        // Slots and tools are boxes (a clamped quote keeps rects for its hidden lines): their own box.
        return el.matches('.cc-classroom-bar__tools > *, .cc-topbar__slot') || rects.length === 0 ? [el.getBoundingClientRect()] : rects;
      };
      const vw = document.documentElement.clientWidth;
      for (let i = 0; i < items.length; i++) {
        const [a, ea] = items[i]!;
        const ra = ea.getBoundingClientRect();
        if (ra.left < -0.5 || ra.right > vw + 0.5) out.push(`${a} leaves the screen (${Math.round(ra.left)}–${Math.round(ra.right)} of ${vw})`);
        // A tool keeps its whole label; a text block keeps every word inside its own box (word by word:
        // a hanging space after a wrapped, centred line is not a cut word).
        if (ea.matches('.cc-classroom-bar__tools > *')) {
          if (ea instanceof HTMLElement && ea.scrollWidth > ea.clientWidth + 1) out.push(`${a} is cut off (${ea.scrollWidth}px in ${ea.clientWidth}px)`);
        } else {
          const walker = document.createTreeWalker(ea, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.parentElement?.closest('.cc-visually-hidden')) continue;
            for (const m of (n.textContent ?? '').matchAll(/\S+/gu)) {
              const range = document.createRange();
              range.setStart(n, m.index);
              range.setEnd(n, m.index + m[0].length);
              for (const r of range.getClientRects()) {
                // Lines a clamp hides lie below the box: only what is shown counts.
                if (r.top >= ra.bottom - 1) continue;
                if (r.left < Math.max(ra.left, 0) - 1 || r.right > Math.min(ra.right, vw) + 1)
                  out.push(`${a}: "${m[0]}" is cut off (${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(ra.left)}–${Math.round(ra.right)})`);
              }
            }
          }
        }
        for (let j = i + 1; j < items.length; j++) {
          const [b, eb] = items[j]!;
          if (ea.contains(eb) || eb.contains(ea)) continue;
          for (const x of boxes(ea))
            for (const y of boxes(eb)) {
              const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
              const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
              if (w > 0.5 && h > 0.5) out.push(`${a} overlaps ${b} (${Math.round(w)}×${Math.round(h)} px)`);
            }
        }
      }
      // The class name never breaks ("3-A" on one line) and the subject stays inside the class block.
      const name = document.querySelector('.cc-classroom-bar__name')!;
      const lines = new Set(boxes(name).map((r) => Math.round(r.top)));
      if (lines.size > 1) out.push(`the class name wraps onto ${lines.size} lines`);
      const cls = document.querySelector('.cc-classroom-bar__class')!.getBoundingClientRect();
      for (const sel of ['.cc-classroom-bar__name', '.cc-classroom-bar__subject']) {
        for (const r of boxes(document.querySelector(sel)!)) if (r.right > cls.right + 0.5 || r.left < cls.left - 0.5) out.push(`${sel} runs out of the class block`);
      }
      if (bar.scrollWidth > bar.clientWidth + 1) out.push(`the bar scrolls sideways (${bar.scrollWidth} > ${bar.clientWidth})`);
      if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
      return out;
    }
  }, quote);
}

/** Quotes whose longest word is longest (and the longest quote) in a language: the hardest to fit. */
function hardQuotes(list: readonly string[]): string[] {
  const longestWord = (q: string) => Math.max(...q.split(/\s+/u).map((w) => w.length));
  const byWord = [...list].sort((a, b) => longestWord(b) - longestWord(a)).slice(0, 4);
  const longest = [...list].sort((a, b) => b.length - a.length)[0]!;
  return [...new Set([...byWord, longest])];
}

/** The classroom screen-size reports (D-165) are dropped here: 12 board openings would use up their per-address rate limit. */
const quietDisplayReports = (ctx: BrowserContext) => ctx.route('**/api/classroom/display-info', (r) => r.abort());

const setTextScale = (page: Page, scale: number) =>
  page.evaluate(async (s) => {
    document.documentElement.style.setProperty('--cc-text-scale', String(s));
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, scale);

test('classroom top bar: nothing overlaps at 320/375/414 px, 100 and 200 % text, English and Turkish, all four themes (S21b, D-174)', async ({ browser }) => {
  test.skip(test.info().project.name === 'mobile', 'every phone width is set here, on the display project');
  test.setTimeout(360_000);
  mkdirSync(SHOTS, { recursive: true });
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const teacherCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  await quietDisplayReports(teacherCtx);
  const teacher = await teacherCtx.newPage();
  let ctx3a: Ctx | null = null;
  try {
    await login(admin, 'admin');
    if ((await api(admin, 'GET', `/api/admin/themes/${SNOW_KEY}`)).status === 200)
      await api(admin, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, {
        confirm: SNOW_KEY,
      });
    expect((await api(admin, 'POST', '/api/admin/themes', { source: SNOW })).status).toBe(200);
    expect((await api(admin, 'POST', `/api/admin/themes/${SNOW_KEY}/enable`)).status).toBe(200);

    await login(teacher, 'english');
    await ensurePin(teacher);
    ctx3a = await context3A(teacher);
    await endActiveLessons(teacher);
    // A running lesson: the bar then also holds Full screen (the widest set of tools).
    const started = await api(teacher, 'POST', '/api/commands', {
      commands: [
        {
          opId: randomUUID(),
          type: 'lesson.start',
          contextId: ctx3a.id,
          payload: { contextId: ctx3a.id, othersPresent: true, attendance: [] },
        },
      ],
    });
    expect(started.body.results[0].ok).toBe(true);

    const problems: string[] = [];
    for (const lang of ['en', 'tr'] as const) {
      expect(
        (
          await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, {
            mainLanguage: lang,
            secondLanguageEnabled: false,
          })
        ).status,
      ).toBe(200);
      for (const theme of [...THEME_KEYS, SNOW_KEY]) {
        expect(
          (
            await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, {
              theme,
            })
          ).status,
        ).toBe(200);
        await teacher.setViewportSize({ width: 375, height: 812 });
        await open3A(teacher);
        await expect(teacher.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(teacher.getByTestId('lesson-dashboard')).toBeVisible();
        await expect(teacher.getByTestId('topbar-date')).toBeVisible();
        for (const width of [320, 375, 414]) {
          await teacher.setViewportSize({ width, height: 812 });
          for (const scale of [1, 2]) {
            await setTextScale(teacher, scale);
            for (const p of await topBarProblems(teacher)) problems.push(`${theme} ${lang} ${width}px text ${scale * 100} %: ${p}`);
            for (const q of hardQuotes(lang === 'tr' ? QUOTES_TR : QUOTES_EN)) {
              for (const p of await topBarProblems(teacher, q)) problems.push(`${theme} ${lang} ${width}px text ${scale * 100} % with "${q}": ${p}`);
            }
            if (width === 375)
              await teacher.locator('.cc-classroom-bar').screenshot({
                path: `${SHOTS}/topbar-${theme}-${lang}-${width}-${scale * 100}.png`,
              });
          }
          await setTextScale(teacher, 1);
        }
      }
    }
    expect(problems).toEqual([]);
  } finally {
    await endActiveLessons(teacher).catch(() => undefined);
    if (ctx3a) {
      await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, {
        mainLanguage: ctx3a.mainLanguage,
        secondLanguageEnabled: ctx3a.secondLanguageEnabled,
      });
      await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, {
        theme: ctx3a.chosenTheme,
      });
    }
    if ((await api(admin, 'GET', `/api/admin/themes/${SNOW_KEY}`)).status === 200)
      await api(admin, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, {
        confirm: SNOW_KEY,
      });
    await teacherCtx.close();
    await adminCtx.close();
  }
});

const TOAST_SIZES = [
  { width: 375, height: 812, scale: 2, name: '375x812' },
  { width: 768, height: 1024, scale: 1, name: '768x1024' },
  { width: 1536, height: 703, scale: 1.25, name: '1536x703@1.25' },
  { width: 1920, height: 1080, scale: 1, name: '1920x1080' },
] as const;

/** Starts 3-A's lesson through the Start lesson steps (whatever steps are on) on a fresh display. */
async function startThroughSteps(browser: Browser, size: (typeof TOAST_SIZES)[number]) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    hasTouch: true,
  });
  await quietDisplayReports(ctx);
  const page = await ctx.newPage();
  await login(page, 'english');
  await open3A(page);
  await page.getByRole('button', { name: 'Start lesson' }).click();
  const start = page.getByTestId('start-lesson');
  await expect(start).toBeVisible();
  const begin = start.getByRole('button', { name: 'Begin lesson' });
  for (let i = 0; i < 8 && !(await begin.isVisible()); i++) await start.getByRole('button', { name: 'Next', exact: true }).click();
  return { ctx, page, begin };
}

test('the "Lesson started" note never covers the dock or End lesson (S21b, D-174)', async ({ browser }) => {
  test.skip(test.info().project.name === 'mobile', 'every size is set here, on the display project');
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  const setupCtx = await browser.newContext();
  const setup = await setupCtx.newPage();
  await login(setup, 'english');
  await ensurePin(setup);
  try {
    for (const size of TOAST_SIZES) {
      await endActiveLessons(setup);
      const { ctx, page, begin } = await startThroughSteps(browser, size);
      try {
        // Record every frame from Begin lesson until the note is gone: the note against the dock row,
        // each dock button and End lesson.
        await page.evaluate(() => {
          const w = window as unknown as {
            __s21b: { frames: number; checked: number; problems: string[] };
          };
          w.__s21b = { frames: 0, checked: 0, problems: [] };
          const tick = () => {
            w.__s21b.frames++;
            const toasts = [...document.querySelectorAll('[data-testid="toast"]')].filter((t) => t.getClientRects().length > 0);
            const dock = document.querySelector('.cc-dock');
            if (toasts.length && dock) {
              w.__s21b.checked++;
              const targets = [dock, ...dock.querySelectorAll('.cc-btn')].filter((t) => t.getClientRects().length > 0);
              for (const t of toasts) {
                const a = t.getBoundingClientRect();
                for (const d of targets) {
                  const b = d.getBoundingClientRect();
                  const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                  const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                  if (ow > 0.5 && oh > 0.5 && w.__s21b.problems.length < 20)
                    w.__s21b.problems.push(
                      `note "${t.textContent?.trim().slice(0, 30)}" covers ${d === dock ? 'the dock' : `"${d.textContent?.trim().slice(0, 30)}"`} (${Math.round(ow)}×${Math.round(oh)} px)`,
                    );
                }
                if (a.top < 0 || a.bottom > innerHeight) w.__s21b.problems.push(`note off the screen (${Math.round(a.top)}–${Math.round(a.bottom)} of ${innerHeight})`);
              }
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await begin.click();
        await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
        const note = page.getByTestId('toast').filter({ hasText: 'Lesson started' });
        await expect(note).toBeVisible();
        await expect(page.locator('.cc-dock__end')).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/toast-${size.name}.png` });
        await expect(note).toHaveCount(0, { timeout: 15_000 });
        const seen = await page.evaluate(
          () =>
            (
              window as unknown as {
                __s21b: { frames: number; checked: number; problems: string[] };
              }
            ).__s21b,
        );
        expect(seen.checked, `${size.name}: frames with the note and the dock`).toBeGreaterThan(5);
        expect(seen.problems, size.name).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await endActiveLessons(setup).catch(() => undefined);
    await setupCtx.close();
  }
});
