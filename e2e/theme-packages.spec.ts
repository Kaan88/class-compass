/**
 * Theme packages (S14g, D-158; THM-2, THM-3, UX-6): an administrator imports the worked example with
 * one colour that fails contrast, sees the error, fixes it in the page, previews, saves the draft and
 * enables it; a teacher chooses it for 3-A and the classroom display uses its tokens (axe on the
 * classroom and the admin page); deleting it moves the class back to the default theme. Fictional data
 * only; the demo data is put back afterwards.
 *
 * Theme engine (S17a, D-166): the Snow Day example (scene, frames, snowfall, sets) is imported,
 * previewed with Motion on and off, enabled and used by 3-A during a lesson at the real classroom
 * display sizes (1536×703 and 1536×864 at device scale 1.25 with touch, and 1920×1080): the scene, the
 * frames and the snowfall are drawn, the still frame with reduced motion, keyboard focus stays visible
 * on framed cards, tap targets keep their size, axe passes, the snowfall makes no long tasks (> 50 ms),
 * and deleting the theme falls back to the default. Screenshots go to test-results/theme-engine/.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEFAULT_THEME } from '../src/shared/themes.ts';
import { api, ensurePin, login } from './helpers.ts';

const OCEAN = readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', 'ocean.theme.json'), 'utf8');
const SNOW = readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', 'peppermint-snow-day.theme.json'), 'utf8');
const SNOW_KEY = 'peppermint-snow-day';
const PLAIN_KEY = 'snow-day-plain';

async function seriousViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)}`).slice(0, 3).join(' | ')}`);
}

test('import a theme package (bad contrast → fix → enable), use it in a class, delete it (D-158)', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminCtx = await browser.newContext();
  const teacherCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const teacher = await teacherCtx.newPage();
  let classId: string | null = null;
  let before: string | null = null;
  try {
    await login(admin, 'admin');
    // Leftovers of an interrupted run.
    if ((await api(admin, 'GET', '/api/admin/themes/ocean')).status === 200) await api(admin, 'DELETE', '/api/admin/themes/ocean', { confirm: 'ocean' });

    await admin.goto('/admin/themes');
    await expect(admin.getByRole('heading', { name: 'Themes', level: 1 })).toBeVisible();

    // 1. A package whose muted text is too light: the report says so and nothing can be saved.
    const bad = JSON.parse(OCEAN) as { colors: Record<string, string> };
    bad.colors['text-muted'] = '#a9bcc4';
    await admin.getByTestId('theme-file').setInputFiles({ name: 'ocean.theme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad, null, 2)) });
    const textarea = admin.getByLabel('Theme package (JSON)');
    await expect(textarea).toHaveValue(/"text-muted": "#a9bcc4"/u);
    await admin.getByRole('button', { name: 'Check package' }).click();
    const report = admin.getByTestId('theme-report');
    await expect(report.getByTestId('theme-report-errors').locator('li[data-code="CONTRAST"]').first()).toContainText('text-muted');
    await expect(admin.getByTestId('theme-save')).toHaveCount(0);

    // 1b. Transparent text would pass the contrast maths but be unreadable: only the dim layer,
    // shadows and avatar outlines may be translucent (review fix).
    const ghost = JSON.parse(OCEAN) as { colors: Record<string, string> };
    ghost.colors.text = '#0f243000';
    await textarea.fill(JSON.stringify(ghost, null, 2));
    await admin.getByRole('button', { name: 'Check package' }).click();
    await expect(report.getByTestId('theme-report-errors').locator('li[data-code="SCHEMA"]').first()).toContainText('colors.text');
    await expect(admin.getByTestId('theme-save')).toHaveCount(0);

    // 2. Fix it on the page and check again: no errors, a note about the base theme's art, a preview.
    await textarea.fill(OCEAN);
    await expect(admin.getByText('The text changed after the check.')).toBeVisible();
    await admin.getByRole('button', { name: 'Check package' }).click();
    await expect(report).toContainText('No errors.');
    await expect(report.getByTestId('theme-report-warnings')).toContainText('classroom');
    const preview = admin.getByTestId('theme-package-preview');
    await expect(preview).toContainText('Preview: Ocean');
    await expect(preview.getByTestId('theme-preview-area-cc-preview-ocean')).toBeVisible();
    await expect(admin.locator('html')).not.toHaveAttribute('data-theme', 'ocean'); // the live page is untouched
    await preview.getByRole('button', { name: 'Play the celebration' }).click();
    await expect(preview.getByTestId('celebration-preview')).toBeVisible();
    expect(await seriousViolations(admin, '[data-testid="admin-themes"]')).toEqual([]);

    // 3. Save as draft, then enable.
    await admin.getByTestId('theme-save').click();
    const row = admin.getByRole('row', { name: /Ocean/u });
    await expect(row).toContainText('Draft');
    await admin.getByTestId('theme-enable-ocean').click();
    await expect(row).toContainText('Enabled');

    // 4. A teacher chooses it for 3-A in Class settings; the classroom display uses its tokens.
    await login(teacher, 'english');
    await ensurePin(teacher);
    const mine = await api(teacher, 'GET', '/api/teacher/contexts');
    const c3a = (mine.body.contexts as Array<{ classId: string; className: string; theme: string }>).find((c) => c.className === '3-A')!;
    classId = c3a.classId;
    before = c3a.theme;
    await teacher.goto('/teacher/classes');
    await teacher.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    const section = teacher.getByTestId('class-display');
    await section.getByTestId('theme-option-ocean').click();
    await expect(section.getByTestId('theme-option-ocean')).toHaveAttribute('aria-checked', 'true');
    await teacher.goto('/classroom');
    await teacher.getByRole('button', { name: /3-A · English/u }).click();
    await expect(teacher.locator('html')).toHaveAttribute('data-theme', 'ocean');
    await expect.poll(() => teacher.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cc-bg').trim())).toBe('#eef6f8');
    expect(await seriousViolations(teacher)).toEqual([]);

    // 4b. Disabled for a while: the class shows the default theme but keeps its choice, even when the
    // administrator saves the class in the class editor meanwhile (review fix); enabled again, it is back.
    await row.getByRole('button', { name: 'Disable' }).click();
    await expect(row).toContainText('Disabled');
    const off = await api(teacher, 'GET', '/api/teacher/contexts');
    expect((off.body.contexts as Array<{ classId: string; theme: string; chosenTheme: string }>).find((c) => c.classId === classId)).toMatchObject({ theme: DEFAULT_THEME, chosenTheme: 'ocean' });
    await admin.goto('/admin/classes');
    const classRow = admin.getByRole('row').filter({ hasText: 'ocean (switched off)' });
    await expect(classRow).toHaveCount(1);
    await classRow.getByRole('button', { name: 'Edit' }).click();
    const editor = admin.getByRole('dialog');
    await expect(editor.getByTestId('theme-picker-off')).toContainText('ocean');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toHaveCount(0);
    await admin.goto('/admin/themes');
    await admin.getByTestId('theme-enable-ocean').click();
    await expect(row).toContainText('Enabled');
    const back = await api(teacher, 'GET', '/api/teacher/contexts');
    expect((back.body.contexts as Array<{ classId: string; theme: string }>).find((c) => c.classId === classId)!.theme).toBe('ocean');

    // 5. Delete (typed confirmation): the class moves back to the default theme.
    await row.getByRole('button', { name: 'Delete' }).click();
    const dialog = admin.getByRole('alertdialog').or(admin.getByRole('dialog'));
    await dialog.getByRole('textbox').fill('ocean');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(admin.getByText('No imported themes yet.')).toBeVisible();
    const after = await api(teacher, 'GET', '/api/teacher/contexts');
    expect((after.body.contexts as Array<{ classId: string; theme: string }>).find((c) => c.classId === classId)!.theme).toBe(DEFAULT_THEME);
    await teacher.reload();
    await expect(teacher.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
  } finally {
    if ((await api(admin, 'GET', '/api/admin/themes/ocean')).status === 200) await api(admin, 'DELETE', '/api/admin/themes/ocean', { confirm: 'ocean' });
    if (classId && before) await api(admin, 'PATCH', `/api/admin/classes/${classId}`, { theme: before });
    await adminCtx.close();
    await teacherCtx.close();
  }
});

// ---------------------------------------------------------------- S17a theme engine (D-166)
type Ctx = { id: string; classId: string; className: string; theme: string; subjectName: { en: string } };

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

/** The classroom display in its own context at a real display size (D-166 test matrix). */
async function display(browser: Browser, size: { width: number; height: number; scale: number }) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, 'english');
  await page.goto('/classroom');
  await page.getByRole('button', { name: /3-A · English/u }).first().click();
  await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
  return { ctx, page };
}

/** How much of the class the students box shows: its height, whole cards and the "more below" cue. */
async function visibleClass(page: Page) {
  await expect(page.locator('.cc-student-card').first()).toBeVisible();
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.cc-lesson-box[data-box="core.students"] > .cc-lesson-box__body')!;
    const b = body.getBoundingClientRect();
    const whole = [...body.querySelectorAll<HTMLElement>('.cc-student-card')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
    }).length;
    return { height: body.clientHeight, whole, more: document.querySelector('.cc-students-box__more')?.textContent ?? '' };
  });
}

/** Sizes of the board's tap targets: dock buttons, the name buttons and + buttons of the student cards. */
async function tapTargets(page: Page) {
  return page.evaluate(() => {
    const size = (sel: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
    return { dock: size('.cc-dock .cc-btn'), add: size('.cc-student-card__add'), nameHeights: size('[data-testid="student-card-name"]').map((s) => s.h) };
  });
}

test('Snow Day: scene, frames and snowfall at the classroom display sizes, still with reduced motion (D-166)', async ({ browser }) => {
  test.setTimeout(300_000);
  mkdirSync('test-results/theme-engine', { recursive: true });
  const adminCtx = await browser.newContext();
  const teacherCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const teacher = await teacherCtx.newPage();
  let ctx3a: Ctx | null = null;
  try {
    await login(admin, 'admin');
    for (const key of [SNOW_KEY, PLAIN_KEY]) if ((await api(admin, 'GET', `/api/admin/themes/${key}`)).status === 200) await api(admin, 'DELETE', `/api/admin/themes/${key}`, { confirm: key });

    // 1. Import, check and preview: scene, frames and snowfall in the classroom sample, Motion on/off.
    await admin.goto('/admin/themes');
    await admin.getByTestId('theme-file').setInputFiles({ name: `${SNOW_KEY}.theme.json`, mimeType: 'application/json', buffer: Buffer.from(SNOW) });
    await admin.getByRole('button', { name: 'Check package' }).click();
    await expect(admin.getByTestId('theme-report')).toContainText('No errors.');
    // The scene's size against its limits, per layer (S17a review).
    const sceneReport = admin.getByTestId('theme-report-scene');
    await expect(sceneReport).toContainText('Scene: 3 layers');
    await expect(sceneReport).toContainText('limit per layer: 60 KB and 1,500 shapes');
    await expect(sceneReport.locator('li')).toHaveCount(3);
    await expect(sceneReport.locator('li').first()).toContainText(/Layer 1: [\d.]+ KB of 60 KB, [\d,]+ of 1,500 shapes/u);
    const preview = admin.getByTestId('theme-package-preview');
    const sample = preview.getByTestId('theme-sample-classroom');
    await expect(sample.getByTestId('theme-scene')).toHaveAttribute('data-layers', '3');
    await expect(sample.locator('.cc-frame__ring--candy')).toHaveCount(1);
    await expect(sample.locator('.cc-student-card > .cc-frame__edge--drift')).toHaveCount(4);
    const motion = preview.getByTestId('theme-preview-motion');
    await motion.getByRole('button', { name: 'Motion off' }).click();
    await expect(motion.getByRole('button', { name: 'Motion off' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sample.getByTestId('theme-ambient')).toHaveAttribute('data-mode', 'still');
    await expect(sample.getByTestId('theme-ambient')).toHaveAttribute('data-running', 'false');
    await motion.getByRole('button', { name: 'Motion on' }).click();
    await expect(sample.getByTestId('theme-ambient')).toHaveAttribute('data-mode', 'full');
    await expect(sample.getByTestId('theme-ambient')).toHaveAttribute('data-running', 'true');
    // The preview's scene and snowfall stay inside the classroom sample, never over the admin page
    // (S17b review: the contained canvas was still position: fixed over the whole window).
    const box = (await sample.boundingBox())!;
    for (const id of ['theme-ambient', 'theme-scene']) {
      const r = (await sample.getByTestId(id).boundingBox())!;
      expect(r.x, id).toBeGreaterThanOrEqual(box.x - 1);
      expect(r.y, id).toBeGreaterThanOrEqual(box.y - 1);
      expect(r.x + r.width, id).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(r.y + r.height, id).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    await expect(sample.getByTestId('theme-ambient')).toHaveCSS('position', 'absolute');
    await expect(preview.getByTestId('theme-engine-frame')).toContainText('Snow drift');
    await expect(preview.getByTestId('theme-engine-frame')).toContainText('Candy stripe (Routine, Timer)');
    await expect(preview.getByTestId('theme-engine-ambient')).toContainText('Snowfall');
    await expect(preview.getByTestId('theme-engine-sets')).toContainText('Snowflake');
    await expect(preview.getByTestId('theme-engine-scene')).toContainText('The last layer as a strip at the bottom');
    await sample.screenshot({ path: 'test-results/theme-engine/admin-preview.png' });
    expect(await seriousViolations(admin, '[data-testid="admin-themes"]')).toEqual([]);

    // 2. Save as draft, enable (a human step; here the test plays the administrator).
    await admin.getByTestId('theme-save').click();
    await admin.getByTestId(`theme-enable-${SNOW_KEY}`).click();
    await expect(admin.getByRole('row', { name: /Snow Day/u })).toContainText('Enabled');

    // 3. 3-A uses it during a lesson.
    await login(teacher, 'english');
    await ensurePin(teacher);
    ctx3a =((await api(teacher, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
    expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme: SNOW_KEY })).status).toBe(200);
    await endActiveLessons(teacher);
    const started = await api(teacher, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx3a.id, payload: { contextId: ctx3a.id, othersPresent: true, attendance: [] } }],
    });
    expect(started.body.results[0].ok).toBe(true);

    let framedTargets: Awaited<ReturnType<typeof tapTargets>> | null = null;
    const framedClass: Record<string, Awaited<ReturnType<typeof visibleClass>>> = {};
    const sizes = [
      { width: 1536, height: 703, scale: 1.25, name: '1536x703@1.25' },
      { width: 1536, height: 864, scale: 1.25, name: '1536x864@1.25' },
      { width: 1920, height: 1080, scale: 1, name: '1920x1080' },
    ];
    for (const size of sizes) {
      const { ctx, page } = await display(browser, size);
      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', SNOW_KEY);
        await expect(page.locator('html')).toHaveAttribute('data-scene', '');
        await expect(page.getByTestId('theme-scene')).toHaveAttribute('data-layers', '3');
        // Frames: the snow edge on the boxes and cards, the candy stripe on the timer (trimOn); the top
        // bar gets its edge only (S17b review: corners there sat on its buttons and the class name).
        await expect(page.locator('.cc-lesson-box[data-box="core.timer"] > .cc-frame__ring--candy')).toHaveCount(1);
        expect(await page.locator('.cc-lesson-box > .cc-frame__edge--drift').count()).toBeGreaterThan(1);
        expect(await page.locator('.cc-student-card > .cc-frame__edge--drift').count()).toBeGreaterThan(3);
        await expect(page.locator('.cc-classroom-bar > .cc-frame__edge--drift')).toHaveCount(1);
        await expect(page.locator('.cc-classroom-bar > .cc-frame__corner')).toHaveCount(0);
        // Snowfall: running, in device pixels.
        const canvas = page.getByTestId('theme-ambient');
        await expect(canvas).toHaveAttribute('data-mode', 'full');
        await expect(canvas).toHaveAttribute('data-running', 'true');
        await expect(canvas).toHaveAttribute('data-frames', /\d+/u, { timeout: 5000 });
        const px = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, dpr: devicePixelRatio }));
        // Backing store capped at 2 (S17a review); the classroom PC's 1.25 is below the cap.
        const ratio = Math.min(2, px.dpr);
        expect(px.w).toBe(Math.round(px.cw * ratio));
        expect(px.h).toBe(Math.round(px.ch * ratio));
        expect(px.dpr).toBe(size.scale);
        if (size.height < 1000) framedClass[size.name] = await visibleClass(page);
        else {
          // Where the grid ends, the scene shows (no full-height card over it; S17a review).
          const free = await page.evaluate(() => {
            const body = document.querySelector<HTMLElement>('.cc-lesson-box[data-box="core.students"] > .cc-lesson-box__body')!;
            const cards = [...body.querySelectorAll<HTMLElement>('.cc-student-card')];
            const last = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
            const b = body.getBoundingClientRect();
            const y = Math.round((last + b.bottom) / 2);
            const hit = document.elementFromPoint(Math.round(b.right - 40), y);
            return { space: b.bottom - last, background: getComputedStyle(body).backgroundColor, hitCard: !!hit?.closest('.cc-student-card, .cc-card') };
          });
          expect(free.space).toBeGreaterThan(40);
          expect(free.background).toBe('rgba(0, 0, 0, 0)');
          expect(free.hitCard).toBe(false);
        }
        if (size.width === 1536 && size.height === 703) {
          // Performance: no long task (> 50 ms) while the snow falls for three seconds.
          const longTasks = await page.evaluate(
            () =>
              new Promise<number[]>((resolve) => {
                const seen: number[] = [];
                const po = new PerformanceObserver((list) => list.getEntries().forEach((e) => seen.push(Math.round(e.duration))));
                po.observe({ type: 'longtask' });
                setTimeout(() => {
                  po.disconnect();
                  resolve(seen);
                }, 3000);
              }),
          );
          expect(longTasks.filter((d) => d > 50)).toEqual([]);
          framedTargets = await tapTargets(page);
        }
        await page.screenshot({ path: `test-results/theme-engine/board-${size.name}-motion.png` });
        expect(await seriousViolations(page)).toEqual([]);

        // Keyboard focus on a framed card: the ring is visible and no overlay covers it.
        const name = page.getByTestId('student-card-name').first();
        await name.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(name).toBeFocused();
        const focus = await name.evaluate((el) => {
          const s = getComputedStyle(el);
          const card = el.closest('.cc-student-card')!;
          return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), overlays: [...card.querySelectorAll<HTMLElement>(':scope > .cc-frame--over')].map((o) => getComputedStyle(o).opacity) };
        });
        expect(focus.outline).not.toBe('none');
        expect(focus.width).toBeGreaterThan(0);
        await expect.poll(async () => name.evaluate((el) => [...el.closest('.cc-student-card')!.querySelectorAll<HTMLElement>(':scope > .cc-frame--over')].every((o) => getComputedStyle(o).opacity === '0'))).toBe(true);
        expect(focus.overlays.length).toBeGreaterThan(0);

        // Motion off (reduced motion): the snow stops at once, without a reload (S17a review) …
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(page.getByTestId('theme-ambient')).toHaveAttribute('data-mode', 'still');
        await expect(page.getByTestId('theme-ambient')).toHaveAttribute('data-running', 'false');
        // … and after a reload it is the same scene and snow, standing still.
        await page.reload();
        await expect(page.getByTestId('lesson-dashboard')).toBeVisible();
        await expect(page.getByTestId('theme-scene')).toBeVisible();
        await expect(page.getByTestId('theme-ambient')).toHaveAttribute('data-mode', 'still');
        await expect(page.getByTestId('theme-ambient')).toHaveAttribute('data-running', 'false');
        await page.screenshot({ path: `test-results/theme-engine/board-${size.name}-still.png` });
      } finally {
        await ctx.close();
      }
    }

    // 3b. A phone: the scene's last layer is a strip standing on the dock, not hidden under it.
    {
      const { ctx, page } = await display(browser, { width: 375, height: 812, scale: 2 });
      try {
        await expect(page.getByTestId('theme-scene')).toHaveAttribute('data-strip', '');
        const strip = await page.evaluate(() => {
          const layer = document.querySelector<SVGElement>('[data-testid="theme-scene"] .cc-scene__layer')!.getBoundingClientRect();
          const dock = document.querySelector<HTMLElement>('.cc-lesson-row[data-dock-row]')!.getBoundingClientRect();
          return { layerBottom: Math.round(layer.bottom), dockTop: Math.round(dock.top), dockBottom: Math.round(dock.bottom), vh: innerHeight };
        });
        expect(strip.dockBottom).toBeLessThanOrEqual(strip.vh + 1);
        expect(Math.abs(strip.layerBottom - strip.dockTop)).toBeLessThanOrEqual(2);
        await page.screenshot({ path: 'test-results/theme-engine/board-375x812.png' });
      } finally {
        await ctx.close();
      }
    }

    // 4. Tap targets are the same size as without a frame: the same package without scene, frame,
    // ambient and sets (same fonts and shapes), on the same display. The frames take no room: the
    // students box is as high and shows as many whole cards as without them (S17a review).
    const plainPkg = JSON.parse(SNOW) as Record<string, any>;
    for (const k of ['scene', 'frame', 'ambient', 'sets']) delete plainPkg[k];
    plainPkg.key = PLAIN_KEY;
    expect((await api(admin, 'POST', '/api/admin/themes', { source: JSON.stringify(plainPkg) })).status).toBe(200);
    expect((await api(admin, 'POST', `/api/admin/themes/${PLAIN_KEY}/enable`)).status).toBe(200);
    expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme: PLAIN_KEY })).status).toBe(200);
    for (const size of sizes.slice(0, 2)) {
      const { ctx, page } = await display(browser, size);
      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', PLAIN_KEY);
        await expect(page.locator('.cc-frame')).toHaveCount(0);
        await expect(page.getByTestId('theme-scene')).toHaveCount(0);
        expect(await visibleClass(page), size.name).toEqual(framedClass[size.name]);
        if (size !== sizes[0]) continue;
        const plain = await tapTargets(page);
        // The same axe result without any theme frame or scene (the stage chips above are not new).
        expect(await seriousViolations(page)).toEqual([]);
        expect(framedTargets).not.toBeNull();
        expect(framedTargets!.dock).toEqual(plain.dock);
        expect(framedTargets!.add).toEqual(plain.add);
        expect(framedTargets!.nameHeights).toEqual(plain.nameHeights);
      } finally {
        await ctx.close();
      }
    }

    // 5. Delete: classes that use it fall back to the default theme.
    expect((await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme: SNOW_KEY })).status).toBe(200);
    expect((await api(admin, 'DELETE', `/api/admin/themes/${SNOW_KEY}`, { confirm: SNOW_KEY })).status).toBe(200);
    const after = (await api(teacher, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
    expect(after.find((c) => c.id === ctx3a!.id)!.theme).toBe(DEFAULT_THEME);
    {
      const { ctx, page } = await display(browser, sizes[0]!);
      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
        // No snow left: the default theme's own scene since S17b (D-168), with no ambient layer.
        await expect(page.locator('.cc-frame__edge--drift')).toHaveCount(0);
        await expect(page.getByTestId('theme-scene')).toHaveAttribute('data-layers', '2');
        await expect(page.getByTestId('theme-ambient')).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await endActiveLessons(teacher).catch(() => undefined);
    for (const key of [SNOW_KEY, PLAIN_KEY]) if ((await api(admin, 'GET', `/api/admin/themes/${key}`)).status === 200) await api(admin, 'DELETE', `/api/admin/themes/${key}`, { confirm: key });
    if (ctx3a) await api(admin, 'PATCH', `/api/admin/classes/${ctx3a.classId}`, { theme: ctx3a.theme });
    await adminCtx.close();
    await teacherCtx.close();
  }
});

test('the student page sample in the package preview never splits a tile word that fits (S21 review)', async ({ browser }) => {
  test.skip(test.info().project.name === 'mobile', 'the widths are set here, on the display project');
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await login(page, 'admin');
  const examples = readdirSync(join(import.meta.dirname, '..', 'docs', 'examples')).filter((f) => f.endsWith('.theme.json'));
  const split: string[] = [];
  try {
    for (const lang of ['en', 'tr'] as const) {
      expect((await api(page, 'PATCH', '/api/auth/preferences', { locale: lang })).status).toBe(200);
      for (const file of examples) {
        // 1280 px is where the review saw "Achievemen / ts"; 900 px gives the tiles the same width.
        for (const width of [1280, 900]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto('/admin/themes');
          await page.getByTestId('theme-file').setInputFiles({ name: file, mimeType: 'application/json', buffer: readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', file)) });
          await page.getByRole('button', { name: lang === 'en' ? 'Check package' : 'Paketi denetle', exact: true }).click();
          await expect(page.getByTestId('theme-sample-student')).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          // A word whose own boxes sit on more than one line was split inside the word.
          const words = await page.getByTestId('theme-sample-student').evaluate((sample) =>
            [...sample.querySelectorAll('.cc-menu-tile')].flatMap((tile) => {
              const text = tile.firstChild!;
              return [...(text.textContent ?? '').matchAll(/\S+/gu)].flatMap((m) => {
                const r = document.createRange();
                r.setStart(text, m.index!);
                r.setEnd(text, m.index! + m[0].length);
                return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1 ? [m[0]] : [];
              });
            }),
          );
          split.push(...words.map((w) => `${lang} ${file} ${width}px: "${w}"`));
        }
      }
    }
    expect(split).toEqual([]);
  } finally {
    await api(page, 'PATCH', '/api/auth/preferences', { locale: 'en' });
    await ctx.close();
  }
});
