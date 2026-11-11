/**
 * Built-in themes remade with the theme engine (S17b, D-168; THM-2, THM-3, UX-6): the board of 3-A in
 * every built-in theme and in the Snow Day example package, at the real classroom display sizes
 * (1536×703 and 1536×864 at device scale 1.25 with touch, 1920×1080) and on a 375 px phone, with
 * motion on and off (reduced motion):
 * - every built-in theme draws its scene, its frames (edge, trim on the routine and timer, corners) and,
 *   for Animals, falling leaves that stand still with reduced motion;
 * - frame edges keep their proportions (their SVG units are CSS pixels: no stretched path);
 * - with a scene the dock is content-width and centred on wide screens, so the scene shows beside it;
 * - on a phone the dock is one compact line (S23b, D-183: the buttons that fit whole, "More" with the
 *   count of the others, End lesson); no dock button is cut off, covered or drawn on another (every
 *   pair of drawn buttons checked by their boxes), each is at least var(--cc-touch) and a tap at its
 *   centre lands on it, folded or opened with "More", at 320, 360, 375 and 414 px in English and Turkish
 *   and at 375 px with 200 % text (the second test); axe clean;
 * - no frame corner sits on a control or on the class name (S17b review);
 * - the class tabs never break a word that fits on a line of the tab, and the "N more students
 *   below" cue covers no student card (S21 review);
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
 * `.cc-frame__corner` against every button, link, input and the class name on the board. A control is
 * taken where it is in view: clipped to the box that scrolls it, and left out when less than half of
 * it is in view (S23b: the top few pixels of the cut row's card under "N more students below" peek
 * out at the box's bottom corner; that row is reached by the cue, not by those pixels).
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
        let b = t.getBoundingClientRect();
        for (let p = t.parentElement; p; p = p.parentElement) {
          if (!/(auto|scroll|hidden|clip)/u.test(getComputedStyle(p).overflowY)) continue;
          const s = p.getBoundingClientRect();
          const top = Math.max(b.top, s.top);
          const bottom = Math.min(b.bottom, s.bottom);
          if (bottom - top < b.height / 2) b = new DOMRect(0, 0, 0, 0);
          else b = new DOMRect(b.left, top, b.width, bottom - top);
          break;
        }
        if (b.width === 0) continue;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 0.5 && h > 0.5) out.push(`${c.getAttribute('class')} on ${t.tagName.toLowerCase()} "${(t.getAttribute('aria-label') ?? t.textContent ?? '').trim().slice(0, 40)}" (${Math.round(w)}×${Math.round(h)} px)`);
      }
    }
    return out;
  });
}

/**
 * The class tabs above the board (S21 review): a word of a tab ("(current)", "English", "progress")
 * broken over two lines while it would fit on one line of the tab, parts of a tab that overlap, and
 * a tab off the screen.
 */
async function splitTabWords(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const btn of document.querySelectorAll<HTMLElement>('.cc-class-switcher .cc-btn')) {
      const cs = getComputedStyle(btn);
      const inner = btn.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const m of text.matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(node, m.index!);
          range.setEnd(node, m.index! + m[0].length);
          const pieces = [...range.getClientRects()].filter((x) => x.width > 0);
          const width = pieces.reduce((sum, x) => sum + x.width, 0);
          if (new Set(pieces.map((x) => Math.round(x.top))).size > 1 && width <= inner + 1) out.push(`"${btn.textContent?.trim()}": "${m[0]}" split (${Math.round(width)} px in ${Math.round(inner)} px)`);
        }
      }
      const parts = [...btn.children].map((c) => ({ c, r: c.getBoundingClientRect() })).filter((x) => x.r.width > 0);
      for (const [i, a] of parts.entries())
        for (const b of parts.slice(i + 1)) {
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > 0.5 && h > 0.5) out.push(`"${btn.textContent?.trim()}": ${a.c.getAttribute('class') ?? a.c.tagName} over ${b.c.getAttribute('class') ?? b.c.tagName}`);
        }
      const r = btn.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5) out.push(`"${btn.textContent?.trim()}" off the screen`);
    }
    return out;
  });
}

/** The "N more students below" cue over a student card, its buttons or its chips (S21 review). */
async function cueOnCards(page: Page) {
  return page.evaluate(() => {
    const cue = document.querySelector<HTMLElement>('[data-testid="students-more"]');
    if (!cue) return [];
    const a = cue.getBoundingClientRect();
    const out: string[] = [];
    for (const t of document.querySelectorAll<HTMLElement>('.cc-student-card, .cc-student-card button, .cc-student-card [role="button"], .cc-student-card .cc-att-chip')) {
      const b = t.getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0.5 && h > 0.5) out.push(`cue on ${t.getAttribute('class') ?? t.tagName} of "${t.closest('.cc-student-card')?.textContent?.trim().slice(0, 30)}" (${Math.round(w)}x${Math.round(h)} px)`);
    }
    return out;
  });
}

/**
 * Everything wrong with the board's dock right now (S23b, D-183; empty when nothing is): every pair of
 * drawn dock buttons by their boxes (none may intersect another, End lesson included), each drawn
 * button inside the dock and the screen, its label whole (no clipped text, no word split over two
 * lines), at least var(--cc-touch) in both directions and the topmost element at its centre (a tap
 * lands on it). A button that is not drawn must be folded behind a visible "More" that counts it,
 * and inert (no keyboard focus on a button nobody sees). The dock is scrolled into view first; an
 * opened dock taller than its limit (200 % text) scrolls inside itself, so each button is scrolled to
 * before its own checks.
 */
async function dockProblems(page: Page) {
  await page.getByTestId('lesson-dock').scrollIntoViewIfNeeded();
  return page.evaluate(() => {
    const out: string[] = [];
    const nav = document.querySelector<HTMLElement>('.cc-dock')!;
    const probe = document.createElement('div');
    probe.style.height = 'var(--cc-touch)';
    document.body.append(probe);
    const touch = probe.getBoundingClientRect().height;
    probe.remove();
    const more = nav.querySelector<HTMLElement>('[data-testid="dock-more"]');
    const all = [...nav.querySelectorAll<HTMLElement>('.cc-btn')];
    const drawn = all.filter((b) => b.getClientRects().length > 0);
    const name = (b: Element) => (b.textContent ?? '').trim().replace(/\s+/gu, ' ');
    for (const b of drawn) {
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const d = nav.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      if (r.left < d.left - 0.5 || r.right > d.right + 0.5 || r.top < d.top - 0.5 || r.bottom > d.bottom + 0.5) out.push(`"${name(b)}" outside the dock`);
      if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) out.push(`"${name(b)}" off the screen`);
      if (b.scrollWidth > b.clientWidth + 1) out.push(`"${name(b)}" cut off (${b.scrollWidth}px in ${b.clientWidth}px)`);
      if (r.height < touch - 0.5 || r.width < touch - 0.5) out.push(`"${name(b)}" smaller than the touch size (${Math.round(r.width)}×${Math.round(r.height)})`);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !b.contains(hit)) out.push(`"${name(b)}" covered at its centre by ${hit?.className || hit?.tagName}`);
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        for (const m of (n.textContent ?? '').matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          if (new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1) out.push(`"${name(b)}": "${m[0]}" split over two lines`);
        }
    }
    for (const [i, a] of drawn.entries())
      for (const b of drawn.slice(i + 1)) {
        const x = a.getBoundingClientRect();
        const y = b.getBoundingClientRect();
        const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
        const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
        if (w > 0.5 && h > 0.5) out.push(`"${name(a)}" and "${name(b)}" overlap (${Math.round(w)}×${Math.round(h)} px)`);
      }
    const folded = all.filter((b) => b !== more && !drawn.includes(b));
    for (const b of folded) if (!b.closest('[inert]')) out.push(`"${name(b)}" not drawn but not inert`);
    if (folded.length > 0 && (!more || !drawn.includes(more))) out.push(`${folded.length} buttons folded without "More"`);
    if (folded.length > 0 && more && !name(more).includes(`+${folded.length}`)) out.push(`"More" says "${name(more)}" for ${folded.length} folded buttons`);
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
            // S21 review: tab parts wrap as whole units, and the "more students" cue covers no card.
            expect(await splitTabWords(page), `${theme} ${size.name} class tabs`).toEqual([]);
            expect(await cueOnCards(page), `${theme} ${size.name} more-students cue`).toEqual([]);

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
              const tops = [...nav.querySelectorAll<HTMLElement>('.cc-btn')].filter((b) => b.getClientRects().length > 0).map((b) => Math.round(b.getBoundingClientRect().top));
              const end = nav.querySelector<HTMLElement>('.cc-dock__end')!.getBoundingClientRect();
              // Buttons keep their whole label and do not overlap (on a phone those that do not fit are folded, D-183).
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
              // S23b (D-183): every drawn dock button whole, uncovered, on no other; the rest behind "More".
              expect(await dockProblems(page), `${theme} phone dock`).toEqual([]);
            } else if (size.width >= 1536) {
              // With a scene the dock is content-width and centred: the scene shows on both sides.
              const left = dock.l - dock.rowL;
              const right = dock.rowR - dock.r;
              expect(left, `${theme} dock left gap`).toBeGreaterThan(40);
              expect(Math.abs(left - right), `${theme} dock centred`).toBeLessThanOrEqual(2);
            }
            // axe at the classroom display size and on the phone (the folded dock).
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

/**
 * S23b (D-183): the phone dock in every theme (the three built-ins and Snow Day) at 320, 360, 375 and
 * 414 px (812 px high), in English and Turkish (3-A switched to one language; Turkish with reduced
 * motion), and at 375 px with 200 % text: folded it is one line ("More" counts the buttons it holds,
 * and from 360 px with 100 % text at least the first panel button is in it) and opened it shows every
 * button; in both, no pair of dock buttons intersects, each is whole and a tap at its centre lands on
 * it (`dockProblems`). The widths are visited in turn on one page, so the fold must follow the width,
 * not the widths before it (S23b review: with reduced motion a dock folded at 320 px stayed folded). Before the fix End lesson's box lay on Daily Assistant's at every width (the
 * scrolling row clipped Daily Assistant under it). The class's language and theme and the package are
 * put back in `finally`.
 */
test('phone dock: every button whole and on no other, folded and opened (S23b, D-183)', async ({ browser }) => {
  test.setTimeout(600_000);
  const shots = 'test-results/s23b';
  mkdirSync(shots, { recursive: true });
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  type LangCtx = Ctx & { mainLanguage: 'en' | 'tr'; secondLanguageEnabled: boolean };
  let ctx3a: LangCtx | null = null;
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
    ctx3a = ((await api(teacher, 'GET', '/api/teacher/contexts')).body.contexts as LangCtx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
    await endActiveLessons(teacher);
    const started = await api(teacher, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx3a.id, payload: { contextId: ctx3a.id, othersPresent: true, attendance: [] } }],
    });
    expect(started.body.results[0].ok).toBe(true);
    await teacherCtx.close();

    const cases = [
      { width: 320, scale: 1 },
      { width: 360, scale: 1 },
      { width: 375, scale: 1 },
      { width: 414, scale: 1 },
      { width: 375, scale: 2 },
    ];
    for (const lang of ['en', 'tr'] as const) {
      expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
      for (const theme of [...THEME_KEYS, SNOW_KEY]) {
        expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme })).status).toBe(200);
        const ctx = await browser.newContext({ viewport: { width: 320, height: 812 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: lang === 'tr' ? 'reduce' : 'no-preference' });
        const page = await ctx.newPage();
        try {
          await login(page, 'english');
          await page.goto('/classroom');
          await page.getByRole('button', { name: /^3-A · /u }).first().click();
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          const dock = page.getByTestId('lesson-dock');
          await expect(dock).toBeVisible();
          await expect(page.locator('.cc-student-card').first()).toBeVisible();
          for (const c of cases) {
            const what = `${lang} ${theme} ${c.width}px text ${c.scale * 100} %`;
            await page.setViewportSize({ width: c.width, height: 812 });
            await page.evaluate((s) => document.documentElement.style.setProperty('--cc-text-scale', String(s)), c.scale);
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            const more = page.getByTestId('dock-more');
            // Folded: one line of whole buttons (at 200 % text "More" and End lesson may share a second line).
            expect(await dockProblems(page), `${what} folded`).toEqual([]);
            const tops = await dock.locator('.cc-btn').evaluateAll((els) => new Set(els.filter((e) => e.getClientRects().length > 0).map((e) => Math.round(e.getBoundingClientRect().top))).size);
            if (c.scale === 1) {
              expect(tops, `${what} folded lines`).toBe(1);
              expect((await dock.boundingBox())!.height, `${what} folded height`).toBeLessThan(812 * 0.15);
            }
            // From 360 px (the most common Android width) the first panel button stays in the line
            // (S23b review); "More" may then draw only its count, and keeps its word in its name.
            if (c.scale === 1 && c.width >= 360) {
              const inLine = await dock.locator('.cc-dock__item .cc-btn').evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
              expect(inLine, `${what} panel buttons in the folded line`).toBeGreaterThan(0);
              await expect(dock.locator('.cc-dock__item').first().locator('.cc-btn').first(), `${what} first panel button`).toBeVisible();
            }
            if (await more.isVisible()) await expect(more, `${what} "More" name`).toHaveAccessibleName(lang === 'en' ? /^More \+\d+$/u : /^Diğer \+\d+$/u);
            await dock.screenshot({ path: `${shots}/dock-${lang}-${theme}-${c.width}-${c.scale}x.png` });
            if (!(await more.isVisible())) continue;
            await expect(more).toHaveAttribute('aria-expanded', 'false');
            await more.click();
            await expect(more).toHaveAttribute('aria-expanded', 'true');
            await expect(page.locator('.cc-dock__item[data-dock-overflow]')).toHaveCount(0);
            expect(await dockProblems(page), `${what} opened`).toEqual([]);
            await dock.screenshot({ path: `${shots}/dock-${lang}-${theme}-${c.width}-${c.scale}x-open.png` });
            await more.click();
            await expect(more).toHaveAttribute('aria-expanded', 'false');
            expect(await dockProblems(page), `${what} folded again`).toEqual([]);
          }
          await page.evaluate(() => document.documentElement.style.setProperty('--cc-text-scale', '1'));
          await page.setViewportSize({ width: 375, height: 812 });
          expect(await seriousViolations(page), `${lang} ${theme} phone dock axe`).toEqual([]);
          // A folded panel opens from the opened dock (its dialog), and the dock stays open behind it.
          if (await page.getByTestId('dock-more').isVisible()) {
            await page.getByTestId('dock-more').click();
            await page.getByTestId('dock-achievements').click();
            await expect(page.getByTestId('dock-view-achievements')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('dock-view-achievements')).toHaveCount(0);
            await expect(page.getByTestId('dock-achievements')).toBeFocused();
          }
        } finally {
          await ctx.close();
        }
      }
    }
  } finally {
    const t = await browser.newContext();
    const p = await t.newPage();
    await login(p, 'english');
    await endActiveLessons(p).catch(() => undefined);
    await t.close();
    if (ctx3a) await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { mainLanguage: ctx3a.mainLanguage, secondLanguageEnabled: ctx3a.secondLanguageEnabled, theme: ctx3a.theme });
    if ((await api(admin, 'GET', `/api/admin/themes/${SNOW_KEY}`)).status === 200) await api(admin, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, { confirm: SNOW_KEY });
    await adminCtx.close();
  }
});

/**
 * S23b review (D-183): the folded phone dock follows its width, not its history. With reduced motion
 * every property has a tiny transition, and the fit once read End lesson as still stretched: a dock
 * folded fully at 320 px stayed fully folded at 360, 375 and 414 px. On one page with reduced motion
 * the widths are visited 414 -> 320 -> 360 -> 414 -> 320 -> 375, and each fold must equal the fold of a
 * fresh page at that width (and from 360 px keep a panel button in the line).
 */
test('phone dock: the fold follows the width with reduced motion (S23b review, D-183)', async ({ browser }) => {
  test.setTimeout(180_000);
  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  try {
    await login(teacher, 'english');
    await ensurePin(teacher);
    const ctx3a = ((await api(teacher, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
    await endActiveLessons(teacher);
    const started = await api(teacher, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx3a.id, payload: { contextId: ctx3a.id, othersPresent: true, attendance: [] } }],
    });
    expect(started.body.results[0].ok).toBe(true);

    const open = async (width: number) => {
      const ctx = await browser.newContext({ viewport: { width, height: 812 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await login(page, 'english');
      await page.goto('/classroom');
      await page.getByRole('button', { name: /^3-A · /u }).first().click();
      await expect(page.locator('.cc-student-card').first()).toBeVisible();
      await expect(page.getByTestId('lesson-dock')).toBeVisible();
      return { ctx, page };
    };
    const settle = (page: Page) =>
      page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))));
    const folded = (page: Page) => page.locator('.cc-dock__item[data-dock-overflow]').count();
    const inLine = (page: Page) => page.locator('.cc-dock__item .cc-btn').evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);

    const widths = [414, 320, 360, 414, 320, 375];
    const fresh = new Map<number, number>();
    for (const w of new Set(widths)) {
      const { ctx, page } = await open(w);
      try {
        await settle(page);
        fresh.set(w, await folded(page));
      } finally {
        await ctx.close();
      }
    }
    const { ctx, page } = await open(widths[0]!);
    try {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 812 });
        await settle(page);
        expect(await folded(page), `folded at ${w} px after resizing`).toBe(fresh.get(w));
        if (w >= 360) expect(await inLine(page), `panel buttons in the line at ${w} px`).toBeGreaterThan(0);
        expect(await dockProblems(page), `dock at ${w} px after resizing`).toEqual([]);
      }
    } finally {
      await ctx.close();
    }
  } finally {
    await endActiveLessons(teacher).catch(() => undefined);
    await teacherCtx.close();
  }
});
