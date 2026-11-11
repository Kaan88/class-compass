/**
 * Button groups never overflow (S14a, D-147). The owner saw the evidence kind buttons run out of their
 * boxes; this spec measures every row or grid of big choice buttons in the app at 375, 768 and 1280 px,
 * in English and Turkish, at text size 100 % and 200 %:
 * - every button (and label) is at least as wide as its content: scrollWidth ≤ clientWidth + 1;
 * - no button sticks out of its group or off the screen;
 * - a grid has no empty tracks (auto-fill would leave holes and squeeze the buttons).
 * Covered: the student page's home tiles, subject switch, New goal categories, evidence kinds and
 * How is it going? faces (S14d), the avatar family buttons (S17c), the teacher menu grid and the attendance status segments (teacher
 * area), the topic choices (Start Lesson), the group options (group screen, opened from the board's
 * dock), the board's dock itself (S14b) and the lesson reflection (End Lesson). S14e3: no page of the
 * teacher menu scrolls sideways at 375 px with 200 % text (second test). Fictional demo data only; the
 * class language and profile language are put back.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { translate, type Locale, type MessageKey } from '../src/shared/i18n/index.ts';
// Every dictionary registered, staff strings included (S23a, D-182).
import '../tests/messages.ts';
import { api, ensurePin, login, openDock, studentLinkUrl } from './helpers.ts';

const WIDTHS = [375, 768, 1280] as const;
const SCALES = [1, 2] as const;
const LANGS = ['en', 'tr'] as const;

/** Problems found in the groups matched by `selector` (empty when everything fits). */
async function measure(page: Page, selector: string): Promise<{ found: number; problems: string[] }> {
  return page.evaluate((sel) => {
    const problems: string[] = [];
    const groups = [...document.querySelectorAll<HTMLElement>(sel)].filter((g) => g.getClientRects().length > 0);
    const label = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.getAttribute('aria-label') || el.tagName;
    for (const g of groups) {
      const box = g.getBoundingClientRect();
      // A group that scrolls sideways inside itself, or holds a row that does (the phone dock's buttons
      // beside End lesson, S17b), holds items beyond its edge.
      const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
      const items = [...g.querySelectorAll<HTMLElement>('button, label, [role="radio"], a.cc-btn, a.cc-menu-tile')].filter((el) => el.getClientRects().length > 0);
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) problems.push(`"${label(el)}" content ${el.scrollWidth}px in ${el.clientWidth}px`);
        let inside: Element | null = el;
        while (inside && inside !== g && !scrolls(inside)) inside = inside.parentElement;
        const scrollsX = inside !== null && scrolls(inside);
        if (!scrollsX && (r.right > box.right + 1 || r.left < box.left - 1)) problems.push(`"${label(el)}" sticks out of its group (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(box.left)}–${Math.round(box.right)})`);
        // Off the screen counts unless a scroll box (a wide table) holds it and is itself on screen.
        let scroller: HTMLElement | null = el.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
        const inScroller = scroller !== null && scroller.getBoundingClientRect().right <= window.innerWidth + 1;
        if (r.right > window.innerWidth + 1 && !inScroller) problems.push(`"${label(el)}" goes off the screen (${Math.round(r.right)} > ${window.innerWidth})`);
        // A label inside a button that is wider than the button (e.g. a long word).
        for (const inner of el.querySelectorAll<HTMLElement>('span')) {
          const ir = inner.getBoundingClientRect();
          if (ir.width > 0 && (ir.right > r.right + 1 || ir.left < r.left - 1)) problems.push(`label "${label(inner)}" is wider than its button`);
        }
      }
      const cs = getComputedStyle(g);
      if (cs.display === 'grid') {
        const tracks = cs.gridTemplateColumns.split(' ').map((v) => parseFloat(v)).filter((w) => w > 0.5);
        const children = [...g.children].filter((c) => c.getClientRects().length > 0).length;
        if (tracks.length > children) problems.push(`grid has ${tracks.length} columns for ${children} items (empty tracks)`);
      }
    }
    return { found: groups.length, problems };
  }, selector);
}

/** Every width × text size for the groups on the current screen. */
async function checkAll(page: Page, selector: string, what: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of SCALES) {
      await page.evaluate((s) => document.documentElement.style.setProperty('--cc-text-scale', String(s)), scale);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const { found, problems } = await measure(page, selector);
      expect(found, `${what}: shown at ${width}px`).toBeGreaterThan(0);
      expect(problems, `${what} at ${width}px, text ${scale * 100} %`).toEqual([]);
    }
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--cc-text-scale', '1'));
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/Istanbul' });
  return { ctx, page: await ctx.newPage() };
}

test('choice buttons fit at 375/768/1280 px, in English and Turkish, at 100 % and 200 % text', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  const c3a = mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  const setClassLanguage = async (lang: Locale) =>
    expect((await api(page, 'PUT', `/api/teacher/classes/${c3a.classId}/language`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${c3a.id}/roster`)).body.students as Array<{ id: string }>;
  const link = await studentLinkUrl(page, c3a.classId, roster[5]!.id);

  const office = await newPage(browser);
  const display = await newPage(browser);
  try {
    await login(office.page, 'english');
    await login(display.page, 'english');
    for (const lang of LANGS) {
      const T = (key: MessageKey) => translate(lang, key);
      await setClassLanguage(lang);

      // ------------------------------------------------ teacher area (the teacher's own language)
      expect((await api(office.page, 'PATCH', '/api/auth/preferences', { locale: lang })).status).toBe(200);
      await office.page.goto('/teacher');
      await expect(office.page.getByTestId('menu-today')).toBeVisible();
      await checkAll(office.page, '.cc-menu-grid', `${lang} teacher menu`);
      await office.page.goto('/teacher/attendance');
      await expect(office.page.locator('.cc-att-set__statuses').first()).toBeVisible();
      await checkAll(office.page, '.cc-att-set__statuses', `${lang} attendance statuses`);

      // ------------------------------------------------ student page (the class language)
      // A fresh device each time: the student page remembers its language per device.
      // S14d (D-151): the home tiles and subject switch, the category tiles of New goal, the evidence
      // kinds of Show my work and the faces of How is it going?.
      const phone = await newPage(browser);
      const sp = phone.page;
      await sp.goto(link);
      await expect(sp.getByTestId('student-page')).toBeVisible();
      await expect(sp.locator('html')).toHaveAttribute('lang', lang);
      // The teacher pages' phone rules leave the student page alone: its name heading keeps the S14d
      // size of 1.6rem at 375 px (S14e3 review).
      await sp.setViewportSize({ width: 375, height: 900 });
      expect(
        await sp.locator('.cc-student__who .cc-h1').first().evaluate((h) => parseFloat(getComputedStyle(h).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize)),
      ).toBeCloseTo(1.6, 2);
      await sp.setViewportSize({ width: 1280, height: 900 });
      await sp.getByRole('group', { name: T('student.home.subject') }).getByRole('button', { name: lang === 'en' ? 'English' : 'İngilizce', exact: true }).click();
      await checkAll(sp, '.cc-student-tiles', `${lang} student home tiles`);
      await checkAll(sp, '.cc-student__subjects', `${lang} student subject switch`);
      await sp.getByRole('link', { name: T('student.tile.newGoal') }).click();
      await checkAll(sp, '.cc-student-choices', `${lang} new goal categories`);
      await sp.getByTestId('student-back').click();
      await sp.getByRole('link', { name: T('student.tile.showMyWork') }).click();
      await checkAll(sp, '.cc-evidence-modes', `${lang} evidence kinds`);
      await sp.getByTestId('student-back').click();
      // S17c (D-169): the avatar picker's family buttons.
      await sp.getByRole('link', { name: T('student.tile.avatar') }).click();
      await sp.getByTestId('avatar-change').click();
      await expect(sp.locator('.cc-avatar-families')).toBeVisible();
      await checkAll(sp, '.cc-avatar-families', `${lang} avatar families`);
      await sp.getByTestId('student-back').click();
      // The faces belong to a goal: give the student a goal once (the English pass runs first).
      await sp.getByRole('link', { name: T('student.tile.howIsItGoing') }).click();
      await expect(sp.locator('#student-screen-title')).toHaveText(T('student.tile.howIsItGoing'));
      if (await sp.getByRole('button', { name: T('student.tile.newGoal') }).count()) {
        await sp.getByRole('button', { name: T('student.tile.newGoal') }).click();
        await sp.getByRole('button', { name: 'Reading' }).click();
        await sp.getByRole('button', { name: 'I will read a short book every week.' }).click();
        await sp.getByRole('button', { name: T('student.newGoal.save') }).click();
        await expect(sp.getByTestId('student-goal').first()).toBeVisible();
        // Back after a finished flow goes to where it started: How is it going?
        await sp.getByTestId('student-back').click();
        await expect(sp.locator('#student-screen-title')).toHaveText(T('student.tile.howIsItGoing'));
      }
      await sp.locator('.cc-student-choices--list .cc-student-choice').first().click();
      await expect(sp.locator('.cc-student-faces')).toBeVisible();
      await checkAll(sp, '.cc-student-faces', `${lang} how-is-it-going faces`);
      await checkAll(sp, '.cc-student-choices', `${lang} how-is-it-going kinds`);
      await phone.ctx.close();

      // ------------------------------------------------ classroom (the class language)
      const d = display.page;
      await d.goto('/classroom');
      await d.getByRole('button', { name: /3-A · (English|İngilizce)/ }).first().click();
      await d.getByRole('button', { name: T('lesson.start') }).click();
      const start = d.getByTestId('start-lesson');
      for (let i = 0; i < 8 && !(await start.getByTestId('topic-step').isVisible()); i++) await start.getByRole('button', { name: T('common.next'), exact: true }).click();
      await expect(start.getByTestId('topic-step')).toBeVisible();
      await checkAll(d, '.cc-topic-choices', `${lang} topic choices`);

      expect((await api(d, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: c3a.id, payload: { contextId: c3a.id, othersPresent: true, attendance: [] } }] })).body.results[0].ok).toBe(true);
      await d.goto('/classroom');
      await d.getByRole('button', { name: /3-A · (English|İngilizce)/ }).first().click();
      await expect(d.getByTestId('lesson-dashboard')).toBeVisible();

      // The board's dock (S14b, D-148): its buttons and End lesson fit, wrapping on narrow screens; on a
      // phone it is one row that scrolls sideways inside itself (S17b, D-168).
      await expect(d.getByTestId('lesson-dock')).toBeVisible();
      await checkAll(d, '.cc-dock', `${lang} lesson dock`);

      // Groups open from the dock: the group screen is the dock view itself.
      const groups = await openDock(d, 'groups');
      await expect(groups.getByTestId('group-options').getByRole('button').first()).toBeVisible();
      await checkAll(d, '[data-testid="group-options"]', `${lang} group options`);
      await d.keyboard.press('Escape');
      await expect(d.getByTestId('dock-view-groups')).toHaveCount(0);

      await d.getByRole('button', { name: T('lesson.end'), exact: true }).first().click();
      await expect(d.getByTestId('end-lesson').locator('.cc-reflect')).toBeVisible();
      await checkAll(d, '.cc-reflect', `${lang} lesson reflection`);
      await endActiveLessons(page);
    }
  } finally {
    await endActiveLessons(page);
    await setClassLanguage('en');
    await api(office.page, 'PATCH', '/api/auth/preferences', { locale: 'en' }).catch(() => undefined);
    await office.ctx.close();
    await display.ctx.close();
  }
});

/**
 * S14e3 (carried over from S14a): no page of the teacher menu scrolls sideways on a phone (375 px)
 * at 200 % text, in English and Turkish. The pages are read from the menu itself (the Today tiles,
 * the Class setup tile and every tab of the Class setup hub), so a new page is covered automatically.
 */
test('no teacher menu page scrolls sideways at 375 px with 200 % text', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, 'english');
  await ensurePin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/teacher');
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  const hrefs = new Set<string>(['/teacher']);
  const tilesOf = (scope: ReturnType<Page['getByTestId']>) => scope.locator('a.cc-menu-tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
  for (const h of await tilesOf(page.getByTestId('teacher-menu'))) hrefs.add(h);
  await page.goto('/teacher/setup');
  const tabs = page.getByTestId('setup-hub').getByRole('tab');
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').locator('a.cc-menu-tile').first()).toBeVisible();
    for (const h of await tilesOf(page.getByRole('tabpanel'))) hrefs.add(h);
  }
  expect(hrefs.size).toBeGreaterThan(15);
  const problems: string[] = [];
  try {
    for (const lang of LANGS) {
      expect((await api(page, 'PATCH', '/api/auth/preferences', { locale: lang })).status).toBe(200);
      for (const href of hrefs) {
        await page.goto(href);
        await expect(page.locator('main h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        const h1Size = () => page.locator('main h1').first().evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
        await page.evaluate(() => document.documentElement.style.setProperty('--cc-text-scale', '1'));
        const h1At1 = await h1Size();
        await page.evaluate(() => document.documentElement.style.setProperty('--cc-text-scale', '2'));
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        // The page fits because long words wrap, not because headings stop growing (THM-6, WCAG 1.4.4).
        const h1At2 = await h1Size();
        if (h1At2 < h1At1 * 1.9) problems.push(`${lang} ${href}: the h1 grows from ${h1At1}px to only ${h1At2}px at 200 % text`);
        const wide = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth <= vw + 1) return null;
          // The outermost elements that stick out, to name the cause in the failure.
          // (Content inside a box that scrolls or clips sideways, like a wide table's wrapper, does not count.)
          const clipped = (el: HTMLElement) => {
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true;
            return false;
          };
          const out = [...document.querySelectorAll<HTMLElement>('body, body *')]
            .filter((el) => el.getBoundingClientRect().right > vw + 1 && el.getClientRects().length > 0 && !clipped(el))
            .filter((el) => [...el.children].every((c) => (c as HTMLElement).getBoundingClientRect().right <= vw + 1 || clipped(c as HTMLElement)) || el.children.length === 0)
            .slice(0, 4)
            .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(el.getBoundingClientRect().right)}px`);
          return `${document.documentElement.scrollWidth}px wide: ${out.join(', ')}`;
        });
        if (wide) problems.push(`${lang} ${href}: ${wide}`);
      }
    }
  } finally {
    await api(page, 'PATCH', '/api/auth/preferences', { locale: 'en' });
  }
  expect(problems, 'pages that scroll sideways at 375 px, 200 % text').toEqual([]);
});
