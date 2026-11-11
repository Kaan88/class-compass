/**
 * Built-in themes remade with the theme engine (S17b, D-168; THM-2, THM-3, UX-6): the board of 3-A in
 * every built-in theme and in the Snow Day example package, at the real classroom display sizes
 * (1536×703 and 1536×864 at device scale 1.25 with touch, 1920×1080) and on a 375 px phone, with
 * motion on and off (reduced motion):
 * - every built-in theme draws its scene, its frames (edge, trim on the routine and timer, corners) and,
 *   for Animals, falling leaves that stand still with reduced motion;
 * - frame edges keep their proportions (their SVG units are CSS pixels: no stretched path);
 * - with a scene the dock is content-width and centred on wide screens, so the scene shows beside it;
 * - on a phone the dock is one compact row (its buttons scroll sideways beside End lesson, which stays
 *   in view), every button reachable and fully tappable, at least var(--cc-touch) high, axe clean;
 * - no frame corner sits on a control or on the class name (S17b review);
 * - axe finds nothing serious on the board in any theme.
 * Screenshots go to `CC_SHOTS_DIR` (default test-results/s17b/after). With `CC_SHOTS_ONLY=1` only the
 * screenshots are taken (used once for the "before" set on the S17a code). Fictional demo data only;
 * the class theme and the imported package are put back.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEFAULT_THEME, THEME_KEYS } from '../src/shared/themes.ts';
import { api, ensurePin, login } from './helpers.ts';

const SNOW = readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', 'peppermint-snow-day.theme.json'), 'utf8');
const SNOW_KEY = 'peppermint-snow-day';
const SHOTS = process.env.CC_SHOTS_DIR ?? 'test-results/s17b/after';
const SHOTS_ONLY = process.env.CC_SHOTS_ONLY === '1';

type Ctx = { id: string; classId: string; className: string; theme: string; subjectName: { en: string } };

const SIZES = [
  { width: 1536, height: 703, scale: 1.25, name: '1536x703@1.25' },
  { width: 1536, height: 864, scale: 1.25, name: '1536x864@1.25' },
  { width: 1920, height: 1080, scale: 1, name: '1920x1080' },
  { width: 375, height: 812, scale: 2, name: '375x812@2' },
] as const;

/** What each built-in theme must show (the brief's choices, D-168). */
const EXPECT: Record<(typeof THEME_KEYS)[number], { edge: string; trim: string; corner: string; ambient: boolean }> = {
  explorer: { edge: 'torn', trim: '.cc-frame__stitch', corner: '.cc-frame__corner--top-right', ambient: false },
  animals: { edge: 'none', trim: '.cc-frame__swag', corner: '.cc-frame__corner--top-left', ambient: true },
  classroom: { edge: 'scallop', trim: '.cc-frame__pencil', corner: '.cc-frame__corner--top-right', ambient: false },
};

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)}`).slice(0, 3).join(' | ')}`);
}

async function display(browser: Browser, size: (typeof SIZES)[number], reduced: boolean) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await login(page, 'english');
  await page.goto('/classroom');
  await page.getByRole('button', { name: /3-A · English/u }).first().click();
  await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
  await expect(page.locator('.cc-student-card').first()).toBeVisible();
  return { ctx, page };
}

/** Frame edges whose drawing units differ from CSS pixels by more than 10 % (a stretched path). */
async function stretchedEdges(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<SVGSVGElement>('svg.cc-frame__edge, svg.cc-frame__swag, svg.cc-frame__pencil')]
      .filter((s) => s.getClientRects().length > 0 && getComputedStyle(s).display !== 'none')
      .flatMap((s) => {
        const vb = s.viewBox.baseVal;
        const r = s.getBoundingClientRect();
        if (!vb || vb.width === 0 || r.width < 1) return [];
        const k = r.width / vb.width;
        return Math.abs(k - 1) > 0.1 ? [`${s.getAttribute('class')}: ${Math.round(vb.width)} units in ${Math.round(r.width)} px`] : [];
      }),
  );
}

/**
 * Corner ornaments drawn over a control or the class name (S17b review): every visible
 * `.cc-frame__corner` against every button, link, input and the class name on the board.
 */
async function cornersOnControls(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      return el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    };
    const corners = [...document.querySelectorAll('.cc-frame__corner')].filter(visible);
    const targets = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], .cc-classroom-bar__name')].filter(visible);
    const out: string[] = [];
    for (const c of corners) {
      const a = c.getBoundingClientRect();
      for (const t of targets) {
        const b = t.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0.5 && h > 0.5) out.push(`${c.getAttribute('class')} on ${t.tagName.toLowerCase()} "${(t.getAttribute('aria-label') ?? t.textContent ?? '').trim().slice(0, 40)}" (${Math.round(w)}×${Math.round(h)} px)`);
      }
    }
    return out;
  });
}

test('built-in themes remade: scenes, frames, ambient, dock (S17b, D-168)', async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(SHOTS, { recursive: true });
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  let ctx3a: Ctx | null = null;
  try {
    await login(admin, 'admin');
    await ensurePin(admin).catch(() => undefined);
    if ((await api(admin, 'GET', `/api/admin/themes/${SNOW_KEY}`)).status === 200) await api(admin, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, { confirm: SNOW_KEY });
    expect((await api(admin, 'POST', '/api/admin/themes', { source: SNOW })).status).toBe(200);
    expect((await api(admin, 'POST', `/api/admin/themes/${SNOW_KEY}/enable`)).status).toBe(200);

    const teacherCtx = await browser.newContext();
    const teacher = await teacherCtx.newPage();
    await login(teacher, 'english');
    await ensurePin(teacher);
    ctx3a = ((await api(teacher, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
    await endActiveLessons(teacher);
    const started = await api(teacher, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx3a.id, payload: { contextId: ctx3a.id, othersPresent: true, attendance: [] } }],
    });
    expect(started.body.results[0].ok).toBe(true);
    await teacherCtx.close();

    for (const theme of [...THEME_KEYS, SNOW_KEY]) {
      expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme })).status).toBe(200);
      for (const size of SIZES) {
        for (const reduced of [false, true]) {
          const { ctx, page } = await display(browser, size, reduced);
          try {
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            // Let the ambient draw a few frames and the fonts settle.
            await page.waitForTimeout(reduced ? 300 : 900);
            await page.screenshot({ path: `${SHOTS}/board-${theme}-${size.name}-${reduced ? 'still' : 'motion'}.png` });
            if (SHOTS_ONLY) continue;
            const phone = size.width < 640;

            // Every theme now has a scene (the phone shows its last layer as a strip).
            await expect(page.locator('html')).toHaveAttribute('data-scene', '');
            await expect(page.getByTestId('theme-scene')).toBeVisible();
            expect(await stretchedEdges(page), `${theme} ${size.name}`).toEqual([]);
            expect(await cornersOnControls(page), `${theme} ${size.name} corners on controls`).toEqual([]);

            const exp = (EXPECT as Record<string, (typeof EXPECT)['explorer'] | undefined>)[theme];
            if (exp && !phone) {
              if (exp.edge !== 'none') expect(await page.locator(`.cc-lesson-box > .cc-frame__edge--${exp.edge}`).count(), `${theme} edge`).toBeGreaterThan(0);
              await expect(page.locator(`.cc-lesson-box[data-box="core.timer"] > ${exp.trim}`)).toHaveCount(1);
              expect(await page.locator(`.cc-lesson-box > ${exp.corner}`).count(), `${theme} corners`).toBeGreaterThan(0);
            }
            const ambient = page.getByTestId('theme-ambient');
            if (exp?.ambient || theme === SNOW_KEY) {
              await expect(ambient).toHaveAttribute('data-mode', reduced ? 'still' : 'full');
              await expect(ambient).toHaveAttribute('data-running', reduced ? 'false' : 'true');
            } else if (exp) {
              await expect(ambient).toHaveCount(0);
            }

            const dock = await page.evaluate(() => {
              const row = document.querySelector<HTMLElement>('.cc-lesson-row[data-dock-row]')!.getBoundingClientRect();
              const nav = document.querySelector<HTMLElement>('.cc-dock')!;
              const d = nav.getBoundingClientRect();
              const tops = [...nav.querySelectorAll<HTMLElement>(':scope > .cc-btn, :scope > * > .cc-btn')].filter((b) => b.getClientRects().length > 0).map((b) => Math.round(b.getBoundingClientRect().top));
              const end = nav.querySelector<HTMLElement>('.cc-dock__end')!.getBoundingClientRect();
              // Buttons keep their whole label and do not overlap (the phone row's hidden part scrolls under nothing).
              const btns = [...nav.querySelectorAll<HTMLElement>('.cc-btn')].filter((b) => b.getClientRects().length > 0 && !b.classList.contains('cc-dock__end'));
              // The app's touch minimum (var(--cc-touch)), not a fixed number of pixels.
              const probe = document.createElement('div');
              probe.style.height = 'var(--cc-touch)';
              document.body.append(probe);
              const touch = probe.getBoundingClientRect().height;
              probe.remove();
              const squeezed = btns.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().height < touch - 0.5).length;
              const xs = btns.map((b) => b.getBoundingClientRect()).sort((a, b) => a.left - b.left);
              const overlaps = xs.slice(1).filter((r, i) => r.left < xs[i]!.right - 1 && Math.abs(r.top - xs[i]!.top) < 2).length;
              return { rowL: row.left, rowR: row.right, l: d.left, r: d.right, h: d.height, rows: new Set(tops).size, endIn: end.left >= d.left - 1 && end.right <= d.right + 1, vh: innerHeight, vw: innerWidth, squeezed, overlaps };
            });
            expect(dock.squeezed, `${theme} ${size.name} dock buttons keep their labels and touch size`).toBe(0);
            expect(dock.overlaps, `${theme} ${size.name} dock buttons overlap`).toBe(0);
            if (phone) {
              // One compact row, End lesson in view, and most of the screen left for the class.
              expect(dock.rows, `${theme} phone dock rows`).toBe(1);
              expect(dock.endIn).toBe(true);
              expect(dock.h).toBeLessThan(dock.vh * 0.15);
              expect(dock.r).toBeLessThanOrEqual(dock.vw + 1);
              // Every dock button can be reached (S17b review): focused (as with Tab) it is at least
              // partly in view and End lesson is never over it (WCAG 2.4.11); scrolled to, it is fully
              // in view beside End lesson and a tap at its centre lands on it.
              const hidden = await page.evaluate(() => {
                const nav = document.querySelector<HTMLElement>('.cc-dock')!;
                const row = nav.querySelector<HTMLElement>('.cc-dock__items')!;
                const end = nav.querySelector<HTMLElement>('.cc-dock__end')!;
                const out: string[] = [];
                for (const b of [...nav.querySelectorAll<HTMLElement>('.cc-btn')].filter((x) => x !== end && x.getClientRects().length > 0)) {
                  row.scrollLeft = 0;
                  b.focus();
                  const d = row.getBoundingClientRect();
                  const e = end.getBoundingClientRect();
                  let r = b.getBoundingClientRect();
                  if (r.right <= d.left + 8 || r.left >= Math.min(d.right, e.left) - 8) out.push(`${b.textContent?.trim()}: focused but out of view (${Math.round(r.left)}–${Math.round(r.right)})`);
                  b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  r = b.getBoundingClientRect();
                  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  if (r.left < d.left - 1 || r.right > Math.min(d.right, e.left) + 1 || !hit || !b.contains(hit)) out.push(`${b.textContent?.trim()}: ${Math.round(r.left)}–${Math.round(r.right)} beside End at ${Math.round(e.left)}`);
                }
                (document.activeElement as HTMLElement | null)?.blur();
                row.scrollLeft = 0;
                return out;
              });
              expect(hidden, `${theme} phone dock buttons reachable`).toEqual([]);
            } else if (size.width >= 1536) {
              // With a scene the dock is content-width and centred: the scene shows on both sides.
              const left = dock.l - dock.rowL;
              const right = dock.rowR - dock.r;
              expect(left, `${theme} dock left gap`).toBeGreaterThan(40);
              expect(Math.abs(left - right), `${theme} dock centred`).toBeLessThanOrEqual(2);
            }
            // axe at the classroom display size and on the phone (the compact scrolling dock).
            if (!reduced && (size.name === '1536x703@1.25' || phone)) expect(await seriousViolations(page), `${theme} ${size.name} axe`).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }
    if (!SHOTS_ONLY) {
      // Work pages keep the default theme's colours without its scene (D-168): the scene and the
      // ambient layer belong to the classroom screen.
      await admin.goto('/admin');
      await expect(admin.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
      await expect(admin.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(admin.getByTestId('theme-scene')).toHaveCount(0);
      await expect(admin.getByTestId('theme-ambient')).toHaveCount(0);
      await expect(admin.locator('html')).not.toHaveAttribute('data-scene', /.*/u);
    }
  } finally {
    const t = await browser.newContext();
    const p = await t.newPage();
    await login(p, 'english');
    await endActiveLessons(p).catch(() => undefined);
    await t.close();
    if ((await api(admin, 'GET', `/api/admin/themes/${SNOW_KEY}`)).status === 200) await api(admin, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, { confirm: SNOW_KEY });
    if (ctx3a) await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme: ctx3a.theme });
    await adminCtx.close();
  }
});
