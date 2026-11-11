/**
 * S25b school holiday calendar (D-186; RPT-5, DAT-1): an administrator adds a closure on Admin → School
 * holidays and the school-wide report's school days (the attendance coverage denominator) go down by
 * the closed weekdays; deleting it puts them back. The page passes axe on the display and on a phone.
 * The shared demo database is restored in `finally` (every closure the test added is deleted). Fictional data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, login } from './helpers.ts';

const NAME = 'E2E practice break';

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Monday to Wednesday of the week two weeks before this one (always in the past, inside the demo history). */
function pastDays(): { from: string; to: string; dates: string[] } {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7) - 14, 12));
  const dates = [0, 1, 2].map((i) => iso(new Date(monday.getTime() + i * 86_400_000)));
  return { from: dates[0]!, to: dates[2]!, dates };
}

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('admin adds a holiday and the report denominator changes, then deletes it @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  const { from, to } = pastDays();
  const years = (await api(page, 'GET', '/api/admin/years')).body.years as Array<{ id: string; startsOn: string; endsOn: string; archived: boolean }>;
  const year = years.find((y) => y.startsOn <= from && to <= y.endsOn && !y.archived);
  test.skip(!year, 'the demo year does not reach two weeks back yet');
  type Row = { id: string; name: { en?: string }; startsOn: string; endsOn: string };
  const list = async () => (await api(page, 'GET', `/api/admin/years/${year!.id}/closures`)).body.closures as Row[];
  const keep = new Set((await list()).map((c) => c.id));
  /** Weekdays of the report period that some closure covers. */
  const closedWeekdays = (rows: Row[]) => [0, 1, 2, 3, 4].map((i) => addDays(from, i)).filter((d) => rows.some((c) => c.startsOn <= d && d <= c.endsOn)).length;
  const closedBefore = closedWeekdays(await list());
  const usage = async () => {
    const u = (await api(page, 'GET', `/api/admin/reports/usage?from=${from}&to=${addDays(to, 2)}`)).body;
    return u.sections[0].metrics.find((m: { key: string }) => m.key === 'schoolDays').cell.v as number;
  };
  const before = await usage();

  try {
    await page.goto('/admin/holidays');
    await expect(page.getByRole('heading', { name: 'School holidays', level: 1 })).toBeVisible();
    await expect(page.getByText(/Ramazan Bayramı and Kurban Bayramı move every year/u)).toBeVisible();
    // Adds the fixed-date public holidays inside the year (or nothing, when seed:demo-history added them).
    await page.getByRole('button', { name: 'Add Turkish public holidays for this school year' }).click();
    await expect(page.getByText(/Nothing to add|public holidays added/u).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Republic Day' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Add a holiday' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name in English').fill(NAME);
    await dialog.getByLabel('Start date').fill(from);
    await dialog.getByLabel('End date').fill(to);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(NAME).first()).toBeVisible();

    // RPT-5: the closed weekdays are no longer school days, so the denominator goes down.
    expect(await usage()).toBe(before - (closedWeekdays(await list()) - closedBefore));
    expect(closedWeekdays(await list()) - closedBefore).toBeGreaterThanOrEqual(3);

    // Delete it on the page (an in-page "Are you sure?").
    const row = page.getByRole('row').filter({ hasText: NAME });
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row.getByText(/Its days count as school days again/u)).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(NAME)).toHaveCount(0);
    expect(await usage()).toBe(before - (closedWeekdays(await list()) - closedBefore));
  } finally {
    // Shared demo database: delete everything this test added (its closure and the public holidays).
    for (const c of await list()) if (!keep.has(c.id)) await api(page, 'DELETE', `/api/admin/closures/${c.id}`);
  }
});

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
