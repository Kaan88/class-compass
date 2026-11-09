/**
 * Button groups never overflow (S14a, D-147). The owner saw the evidence kind buttons run out of their
 * boxes; this spec measures every row or grid of big choice buttons in the app at 375, 768 and 1280 px,
 * in English and Turkish, at text size 100 % and 200 %:
 * - every button (and label) is at least as wide as its content: scrollWidth ≤ clientWidth + 1;
 * - no button sticks out of its group or off the screen;
 * - a grid has no empty tracks (auto-fill would leave holes and squeeze the buttons).
 * Covered: evidence kinds and the confidence picker (student page), the teacher menu grid and the
 * attendance status segments (teacher area), the topic choices (Start Lesson), the group options
 * (group screen) and the lesson reflection (End Lesson). Later stages add the dock and the student
 * home tiles here. Fictional demo data only; the class language and profile language are put back.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { translate, type Locale, type MessageKey } from '../src/shared/i18n/index.ts';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

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
      const items = [...g.querySelectorAll<HTMLElement>('button, label, [role="radio"], a.cc-btn, a.cc-menu-tile')].filter((el) => el.getClientRects().length > 0);
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) problems.push(`"${label(el)}" content ${el.scrollWidth}px in ${el.clientWidth}px`);
        if (r.right > box.right + 1 || r.left < box.left - 1) problems.push(`"${label(el)}" sticks out of its group (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(box.left)}–${Math.round(box.right)})`);
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
      await expect(office.page.locator('.cc-menu-grid')).toBeVisible();
      await checkAll(office.page, '.cc-menu-grid', `${lang} teacher menu`);
      await office.page.goto('/teacher/attendance');
      await expect(office.page.locator('.cc-att-set__statuses').first()).toBeVisible();
      await checkAll(office.page, '.cc-att-set__statuses', `${lang} attendance statuses`);

      // ------------------------------------------------ student page (the class language)
      // A fresh device each time: the student page remembers its language per device.
      const phone = await newPage(browser);
      await phone.page.goto(link);
      await expect(phone.page.getByTestId('student-page')).toBeVisible();
      await expect(phone.page.locator('html')).toHaveAttribute('lang', lang);
      await checkAll(phone.page, '.cc-evidence-modes', `${lang} evidence kinds`);
      // The confidence picker belongs to a self-assessment about a goal: give the student a goal once.
      const english = phone.page.getByRole('region', { name: lang === 'en' ? 'English' : 'İngilizce', exact: true });
      if (!(await english.getByTestId('reflection-form').count())) {
        // Runs in the English pass first, so the English demo names apply.
        await english.getByLabel(T('student.category')).selectOption({ label: 'Reading' });
        await english.getByLabel(T('student.chooseGoal')).selectOption({ label: 'I will read a short book every week.' });
        await english.getByRole('button', { name: T('student.addGoalButton') }).click();
      }
      const form = english.getByTestId('reflection-form');
      await expect(form).toBeVisible();
      await form.getByLabel(T('student.reflectionKind')).selectOption('self_assessment');
      await checkAll(phone.page, '.cc-confidence-picker .cc-row', `${lang} confidence picker`);
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

      const groups = d.getByTestId('groups-panel');
      await expect(groups).toBeVisible();
      await groups.getByRole('button', { name: T('grouping.choose') }).click();
      await expect(d.getByTestId('group-options').getByRole('button').first()).toBeVisible();
      await checkAll(d, '[data-testid="group-options"]', `${lang} group options`);
      await d.keyboard.press('Escape');
      await expect(d.getByTestId('group-screen')).toHaveCount(0);

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
