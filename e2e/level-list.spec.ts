/**
 * Ordered level list per class+subject (S25c, D-187, GRP-3). Fictional demo data only.
 * Grouping → Levels for 3-A English: start an empty list, type Gold, Silver, Bronze, move Bronze to the
 * top with the keyboard, save; the level fields become pickers and three students get a level from
 * them; the order used says it comes from the list; level groups made after that follow the list
 * (Bronze < Silver < Gold, not the alphabetical Bronze < Gold < Silver). Axe on the tab.
 * The demo levels and list are put back in `finally` (the e2e suite shares one database).
 */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { api, login } from './helpers.ts';

const METAL = (i: number) => ['Bronze', 'Silver', 'Gold'][i % 3]!;

test('set a level list, pick levels from it, and level groups follow its order', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  const contextId = mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
  const overview = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/grouping`)).body as { levelList: string[]; students: Array<{ id: string; fullName: string; level: string | null }> };
  const students = overview.students;
  const beforeLevels = students.map((s) => ({ studentId: s.id, level: s.level }));
  const beforeList = overview.levelList;
  const created: string[] = [];
  try {
    expect(students.length).toBeGreaterThan(6);
    expect((await api(page, 'PUT', `/api/teacher/contexts/${contextId}/grouping/level-list`, { contextId, labels: [] })).status).toBe(200);
    // Everyone but the first three gets a level here; the first three are picked in the page below.
    const set = await api(page, 'PUT', `/api/teacher/contexts/${contextId}/levels`, { contextId, levels: students.map((s, i) => ({ studentId: s.id, level: i < 3 ? null : METAL(i) })) });
    expect(set.status).toBe(200);

    await page.goto('/teacher/grouping');
    const gp = page.getByTestId('grouping-page');
    await gp.getByLabel('Class', { exact: true }).selectOption({ label: '3-A · English' });
    await gp.getByRole('tab', { name: 'Levels' }).click();
    // Without a list: free text, ranked alphabetically after the known words.
    await expect(gp.getByTestId('level-order')).toHaveText('Order used, lowest first: Bronze < Gold < Silver');
    await expect(gp.getByLabel(`Level of ${students[3]!.fullName}`)).toHaveValue('Bronze');

    const list = gp.getByTestId('level-list');
    await list.getByRole('button', { name: 'Start an empty list' }).click();
    await list.getByLabel('Level 1', { exact: true }).fill('Gold');
    await list.getByRole('button', { name: 'Add a level' }).click();
    await list.getByLabel('Level 2', { exact: true }).fill('Silver');
    await list.getByRole('button', { name: 'Add a level' }).click();
    await list.getByLabel('Level 3', { exact: true }).fill('Bronze');
    // Keyboard: Bronze up twice; the focus stays on the moved level.
    await list.getByRole('button', { name: 'Move level 3 up' }).focus();
    await page.keyboard.press('Enter');
    await expect(list.getByRole('button', { name: 'Move level 2 up' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(list.getByLabel('Level 1', { exact: true })).toHaveValue('Bronze');
    await expect(list.getByLabel('Level 2', { exact: true })).toHaveValue('Gold');
    await list.getByRole('button', { name: 'Move level 3 up' }).click();
    await expect(list.getByLabel('Level 2', { exact: true })).toHaveValue('Silver');
    await list.getByRole('button', { name: 'Save the list' }).click();
    await expect(list.getByTestId('level-list-saved').locator('li')).toHaveText(['Bronze', 'Silver', 'Gold']);
    await expect(gp.getByTestId('level-order')).toContainText('Order used, lowest first (your level list): Bronze < Silver < Gold');

    // The level field is now a picker with the list.
    for (const i of [0, 1, 2]) await gp.getByLabel(`Level of ${students[i]!.fullName}`).selectOption(METAL(i));
    await gp.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Levels saved.')).toBeVisible();
    const after = (await api(page, 'GET', `/api/teacher/contexts/${contextId}/grouping`)).body as { levelList: string[]; students: Array<{ id: string; level: string | null }> };
    expect(after.levelList).toEqual(['Bronze', 'Silver', 'Gold']);
    expect(after.students.slice(0, 3).map((s) => s.level)).toEqual(['Bronze', 'Silver', 'Gold']);

    const axe = await new AxeBuilder({ page }).include('[data-testid="grouping-page"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    // Level groups follow the list: Bronze and Gold (the two ends) never share a group.
    const levelOf = new Map(students.map((s, i) => [s.id, METAL(i)]));
    const t = await api(page, 'POST', `/api/teacher/contexts/${contextId}/grouping/templates`, { contextId, name: { en: 'Two by level (e2e)' }, mode: 'level', sizing: { groupCount: 2 } });
    expect(t.status).toBe(200);
    created.push(t.body.id);
    const bands = (t.body.groups as Array<{ memberIds: string[] }>).map((g) => new Set(g.memberIds.map((id) => levelOf.get(id))));
    expect(bands.some((b) => b.has('Bronze') && b.has('Gold'))).toBe(false);
  } finally {
    for (const id of created) await api(page, 'POST', `/api/teacher/grouping/templates/${id}/archive`, { templateId: id, archived: true });
    await api(page, 'PUT', `/api/teacher/contexts/${contextId}/grouping/level-list`, { contextId, labels: beforeList });
    await api(page, 'PUT', `/api/teacher/contexts/${contextId}/levels`, { contextId, levels: beforeLevels });
  }
});
