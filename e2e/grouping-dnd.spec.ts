/**
 * Group drag-and-drop (S14c, D-150; GRP-3, GRP-5, UX-8). Fictional demo data only.
 * 1. Classroom group screen (3-A, Dolphins): a mouse drag onto "Not in a group" takes a student out
 *    of the groups (the server keeps it), a keyboard drag (the name's drag handle, Enter, Enter) puts
 *    them back, the tap path moves a name into "Not in a group", and the move plays the `groupMove`
 *    sound (the Display popover's Sound check). axe on the group screen with a name picked.
 * 2. Teacher editor: a mouse drag moves a name to another group and onto "Not in a group" (draft,
 *    cancelled, nothing saved). axe on the editor.
 * 3. @mobile: the tap path in the teacher editor on a phone (cancelled, nothing saved).
 * The lesson is ended afterwards; no saved option changes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { api, closeDock, dragInView, ensurePin, login, openDock } from './helpers.ts';

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function axe(page: Page, selector: string) {
  const r = await new AxeBuilder({ page }).include(selector).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
}

const idsIn = (scope: Locator) => scope.locator('[data-student-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-student-id')!));

test('classroom group screen: drag to "Not in a group", keyboard drag back, tap path, groupMove sound', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const contextId = await context3A(page);
  try {
    const started = await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.start', contextId, payload: { contextId, othersPresent: true } }],
    });
    expect(started.body.results[0].ok).toBe(true);
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    const chip = page.getByTestId('sound-chip');
    if (await chip.isVisible()) await chip.click();

    const screen = await openDock(page, 'groups');
    await screen.getByTestId('group-options').getByRole('button', { name: /Dolphins/ }).click();
    const cards = screen.getByTestId('group-card');
    await expect(cards).toHaveCount(5);
    const unplaced = screen.getByTestId('group-unplaced');
    await expect(unplaced).toContainText('Drop a name here to take it out of the groups.');
    const all = (await idsIn(cards)).length;
    expect(all).toBeGreaterThan(10);

    // Mouse drag onto "Not in a group" (D-150): out of the groups at once, and on the server.
    const dragged = cards.nth(0).getByTestId('group-member').first();
    const draggedId = (await dragged.getAttribute('data-student-id'))!;
    const draggedName = (await dragged.getAttribute('aria-label'))!;
    await dragInView(page, dragged, unplaced.getByRole('grid'));
    await expect(unplaced.locator(`[data-student-id="${draggedId}"]`)).toHaveCount(1);
    await expect(cards.locator(`[data-student-id="${draggedId}"]`)).toHaveCount(0);
    await expect
      .poll(async () => ((await api(page, 'GET', `/api/classroom/contexts/${contextId}/lesson`)).body.grouping.notPlaced as Array<{ id: string }>).map((m) => m.id))
      .toEqual([draggedId]);

    // Keyboard: the name's drag handle, Enter starts the drag (focus goes to the first other list),
    // Enter drops it there.
    await unplaced.getByRole('button', { name: `Drag ${draggedName}` }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="group-card"]')))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(unplaced.locator(`[data-student-id="${draggedId}"]`)).toHaveCount(0);
    await expect(cards.locator(`[data-student-id="${draggedId}"]`)).toHaveCount(1);
    await expect.poll(async () => (await api(page, 'GET', `/api/classroom/contexts/${contextId}/lesson`)).body.grouping.notPlaced).toEqual([]);

    // Tap path: tap a name, then "Move here: Not in a group".
    const tapped = cards.nth(1).getByTestId('group-member').first();
    const tappedId = (await tapped.getAttribute('data-student-id'))!;
    await tapped.click();
    await expect(tapped).toHaveAttribute('data-picked', 'true');
    await expect(screen.getByTestId('group-move-hint')).toContainText('Now tap “Move here” on the group for');
    await axe(page, '[data-testid="dock-view-groups"]');
    await unplaced.getByRole('button', { name: 'Move here: Not in a group' }).click();
    await expect(unplaced.locator(`[data-student-id="${tappedId}"]`)).toHaveCount(1);
    await expect(screen.getByRole('button', { name: /^Move here/ })).toHaveCount(0);
    expect((await idsIn(cards)).length).toBe(all - 1);

    // The moves were heard: the Sound check names the groupMove event.
    await closeDock(page, 'groups');
    await page.getByTestId('classroom-settings').click();
    await expect(page.getByTestId('sound-check').getByTestId('sound-last')).toContainText('Student moved to another group at');
    await page.keyboard.press('Escape');
  } finally {
    await endActiveLessons(page);
    await api(page, 'POST', '/api/classroom/leave');
  }
});

async function openLionsEditor(page: Page) {
  await page.goto('/teacher/grouping');
  const gp = page.getByTestId('grouping-page');
  await gp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
  const lions = gp.getByTestId('arrangement').filter({ hasText: 'Lions' });
  await lions.getByRole('button', { name: 'Edit' }).click();
  return gp.getByTestId('grouping-editor');
}

test('teacher editor: drag a name to another group and onto "Not in a group" (draft only)', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);
  const editor = await openLionsEditor(page);
  const groups = editor.locator('.cc-group-editor');
  await expect(groups).toHaveCount(5);
  const unplaced = editor.getByTestId('grouping-unplaced');
  const before = await idsIn(unplaced);

  const member = groups.nth(0).getByTestId('editor-member').first();
  const id = (await member.getAttribute('data-student-id'))!;
  await dragInView(page, member, groups.nth(1).getByRole('grid'));
  await expect(groups.nth(1).locator(`[data-student-id="${id}"]`)).toHaveCount(1);
  await expect(groups.nth(0).locator(`[data-student-id="${id}"]`)).toHaveCount(0);

  await dragInView(page, groups.nth(1).locator(`[data-student-id="${id}"]`), unplaced.getByRole('grid'));
  await expect(unplaced.locator(`[data-student-id="${id}"]`)).toHaveCount(1);
  expect((await idsIn(unplaced)).length).toBe(before.length + 1);
  // No sticky move bar any more (D-150); the hint is a status line.
  await expect(editor.getByTestId('editor-move-bar')).toHaveCount(0);
  await expect(editor.getByTestId('editor-move-hint')).toContainText('Drag a name to another group');
  await axe(page, '[data-testid="grouping-page"]');
  // Nothing is saved: Cancel leaves the option as it was.
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
});

test('teacher editor on a phone: tap a name, then "Move here" @mobile', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);
  const editor = await openLionsEditor(page);
  const groups = editor.locator('.cc-group-editor');
  const member = groups.nth(0).getByTestId('editor-member').first();
  const id = (await member.getAttribute('data-student-id'))!;
  await member.click();
  await expect(member).toHaveAttribute('data-picked', 'true');
  await expect(editor.getByTestId('editor-move-hint')).toContainText('Now tap “Move here” on the group for');
  await groups.nth(2).getByRole('button', { name: /^Move here: / }).click();
  await expect(groups.nth(2).locator(`[data-student-id="${id}"]`)).toHaveCount(1);
  await expect(groups.nth(0).locator(`[data-student-id="${id}"]`)).toHaveCount(0);
  // No horizontal page scroll on the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
});
