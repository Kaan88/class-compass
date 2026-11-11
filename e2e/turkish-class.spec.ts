/**
 * S20d (D-172, refines D-099): a Turkish-only class, with the teacher's own interface in English.
 * - The label editors show only Turkish fields for that class: a new routine's stages (both languages
 *   again when the routine is for all classes, which include English-only ones) and the reminder
 *   counter's main label; the edits reach the classroom screen.
 * - A sample string scan of the classroom display (board and a dock view) and of a student's page
 *   finds no English UI text: no visible line is an English dictionary string (or an English template
 *   with its placeholders filled) that is not also Turkish.
 * The class language, the counter label and the routine are put back in `finally` (the e2e suite
 * shares one database). Fictional demo data only.
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/shared/i18n/en.ts';
import { tr } from '../src/shared/i18n/tr.ts';
import { api, bodyText, ensurePin, login, openDock, studentLinkUrl } from './helpers.ts';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
const context3A = async (page: Page) => ((await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;

async function seriousViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>)
    await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }] });
}

// ---------------------------------------------------------------- the string scan
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** A dictionary text as a whole-line pattern; placeholders match any text. */
const linePattern = (text: string) => new RegExp(`^${text.split(/\{\w+\}/u).map(esc).join('.+')}$`, 'u');
const letters = (text: string) => text.replace(/\{\w+\}/gu, '').replace(/[^\p{L}]/gu, '').length;
const trValues = Object.values(tr as Record<string, string>);
// Only Turkish texts with words of their own (a bare "{name}" would match every line).
const trPatterns = trValues.filter((v) => letters(v) >= 4).map(linePattern);
/** English UI texts that are not Turkish too: at least 4 letters outside the placeholders. */
const englishPatterns = Object.entries(en as Record<string, string>)
  .filter(([k, v]) => (tr as Record<string, string>)[k] !== v && !trValues.includes(v) && letters(v) >= 4)
  .map(([k, v]) => ({ key: k, re: linePattern(v) }));

/** Visible lines that read as English UI text (and not as a Turkish one). */
export function englishUiLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (letters(line) < 4 || trPatterns.some((re) => re.test(line))) continue;
    const hit = englishPatterns.find((p) => p.re.test(line));
    if (hit) out.push(`${line}  ← en['${hit.key}']`);
  }
  return out;
}

test('a Turkish-only class: Turkish label fields only, and no English UI text on the classroom screen or the student page (S20d, D-172, D-099)', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'checked once, on the display project');
  test.setTimeout(240_000);
  // The scan itself: English lines (with filled placeholders too) are found, Turkish ones and names are not.
  expect(englishUiLines([en['lesson.end'], en['timer.setTime'], tr['lesson.end'], 'Ada Yılmaz', en['counters.editor'].replace('{name}', 'Our English Time')].join('\n'))).toHaveLength(3);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const ctx = await context3A(page);
  const setLanguage = async (mainLanguage: 'en' | 'tr', secondLanguageEnabled: boolean) =>
    expect((await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage, secondLanguageEnabled })).status).toBe(200);
  const reminder = () => api(page, 'GET', `/api/teacher/contexts/${ctx.id}/counters`).then((r) => (r.body.counters as Array<{ id: string; kind: string; archived: boolean; labels: { main: Record<string, string> } }>).find((c) => c.kind === 'english_reminders' && !c.archived)!);
  const originalMain = (await reminder()).labels.main;
  const routineName = `Sabah rutini ${Date.now()}`;
  const display = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true });
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  try {
    await setLanguage('tr', false);

    // Routines: a routine for all classes edits both languages; for 3-A only Turkish.
    await page.goto('/teacher/routines');
    await page.getByRole('button', { name: 'New routine' }).click();
    const editor = page.getByRole('form', { name: 'Edit routine' });
    const stage = editor.getByTestId('routine-stage').first();
    await expect(stage.getByLabel('Stage 1 (English)')).toBeVisible();
    await expect(stage.getByLabel('Stage 1 (Turkish)')).toBeVisible();
    await editor.getByLabel('Use in').selectOption({ label: '3-A · English' });
    await expect(stage.getByLabel('Stage 1 (English)')).toHaveCount(0);
    await expect(editor.getByLabel(/\(English\)$/u)).toHaveCount(0);
    await editor.getByLabel('Routine name (Turkish)').fill(routineName);
    await stage.getByLabel('Stage 1 (Turkish)').fill('Selamlaşma');
    expect(await seriousViolations(page, '[aria-label="Edit routine"]')).toEqual([]);
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('article', { name: routineName })).toContainText('Selamlaşma');
    const saved = ((await api(page, 'GET', '/api/teacher/routines')).body.templates as Array<{ id: string; name: Record<string, string>; stages: Array<{ name: Record<string, string> }> }>).find((x) => x.name.tr === routineName)!;
    expect(saved.name).toEqual({ tr: routineName });
    expect(saved.stages[0]!.name).toEqual({ tr: 'Selamlaşma' });

    // Counters: the reminder counter's labels in Turkish only; the edit is saved in Turkish.
    await page.goto('/teacher/counters');
    await page.getByLabel('Class and subject').selectOption({ label: '3-A · English' });
    const card = page.getByTestId('counter-settings').filter({ hasText: en['counters.kind.english'] }).first();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const main = card.getByTestId('counter-main-label');
    await expect(main.getByLabel('Main label (English)')).toHaveCount(0);
    await expect(card.getByLabel(/\(English\)$/u)).toHaveCount(0);
    await main.getByLabel('Main label (Turkish)').fill('İngilizce konuşalım');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await reminder()).labels.main.tr).toBe('İngilizce konuşalım');

    // Grouping: the new arrangement's name and a group's name in Turkish only (not saved).
    await page.goto('/teacher/grouping');
    const gp = page.getByTestId('grouping-page');
    await gp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    await expect(gp.getByTestId('arrangement-name').getByLabel('Name (Turkish)')).toBeVisible();
    await expect(gp.getByTestId('arrangement-name').getByLabel('Name (English)')).toHaveCount(0);
    // Defaults made while the class is Turkish-only are Turkish only ("Aslanlar"); older ones got Turkish when it was switched on.
    await gp.getByTestId('arrangement').first().getByRole('button', { name: 'Edit groups' }).click();
    const groupEditor = gp.getByTestId('grouping-editor');
    await groupEditor.getByText('Name and roles').first().click();
    await expect(groupEditor.getByTestId('group-name').first().getByLabel('Group name (Turkish)')).toHaveValue(/\S/u);
    await expect(groupEditor.getByLabel(/\(English\)$/u)).toHaveCount(0);

    // Goals library: categories, ready-made goals and own starters are stored per subject and teacher,
    // so they reach the teacher's English-only classes of the subject too: both fields (review fix, D-172).
    await page.goto('/teacher/goals');
    const goals = page.getByTestId('goals-page');
    await goals.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    await goals.getByRole('tab', { name: 'Categories and preset goals' }).click();
    const lib = goals.getByTestId('goals-library');
    for (const label of ['Name', 'Goal', 'Starter']) {
      await expect(lib.getByLabel(`${label} (Turkish)`, { exact: true })).toBeVisible();
      await expect(lib.getByLabel(`${label} (English)`, { exact: true })).toBeVisible();
    }

    // The classroom screen of the Turkish-only class: no English UI text on the board or in a dock view.
    const startOk = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true, attendance: [] } }] });
    expect(startOk.body.results[0].ok).toBe(true);
    const d = await display.newPage();
    await login(d, 'english');
    await d.goto('/classroom');
    await d.getByRole('button', { name: /3-A · (English|İngilizce)/u }).first().click();
    await expect(d.getByTestId('lesson-dashboard')).toBeVisible();
    await expect(d.locator('[data-testid="classroom-shell"]')).toHaveAttribute('lang', 'tr');
    await expect(d.getByText('İngilizce konuşalım').first()).toBeVisible();
    const board = await bodyText(d);
    expect(board).toContain(tr['lesson.end']);
    expect(englishUiLines(board), 'English UI text on the Turkish-only board').toEqual([]);
    await openDock(d, 'assistant');
    expect(englishUiLines(await bodyText(d)), 'English UI text in the assistant view').toEqual([]);

    // A student's page of the class: Turkish, no English UI text.
    const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string }>;
    const p = await phone.newPage();
    await p.goto(await studentLinkUrl(page, ctx.classId, roster[7]!.id));
    await expect(p.getByTestId('student-page')).toBeVisible();
    await expect(p.getByRole('navigation', { name: tr['student.home.tiles'] })).toBeVisible();
    expect(englishUiLines(await bodyText(p)), 'English UI text on the student page').toEqual([]);
  } finally {
    await endActiveLessons(page);
    const c = await reminder();
    const full = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/counters`)).body.counters.find((x: { id: string }) => x.id === c.id);
    await api(page, 'PATCH', `/api/teacher/counters/${c.id}`, { labels: { ...full.labels, main: originalMain } });
    const routines = (await api(page, 'GET', '/api/teacher/routines')).body.templates as Array<{ id: string; name: Record<string, string> }>;
    for (const x of routines.filter((r) => r.name.tr === routineName)) await api(page, 'POST', `/api/teacher/routines/${x.id}/archive`, {});
    await setLanguage('en', false);
    await display.close();
    await phone.close();
  }
});
