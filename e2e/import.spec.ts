/**
 * Student list importer (S9: IMP-2, IMP-4, IMP-5, IMP-7): paste a list → preview → fix a row →
 * confirm → report; importing the same list again matches the students by number instead of
 * adding them twice; the first import is undone at the end so the demo data stays as it was.
 * Fictional names only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, ensurePin, login, PIN } from './helpers.ts';

const letters = () => Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

test('paste a list, fix a row, confirm, see the report; a re-import shows existing students', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN });
  const tag = letters();
  const base = 90_000 + Math.floor(Math.random() * 9_000);
  const list = [`Öğrenci Listesi`, ``, `1. Defne Kurgu${tag} ${base + 1}`, `2. ARDA KURGU${tag.toUpperCase()} ${base + 2}`, `3. Mira Kurgu${tag} ${base + 3}`, ``].join('\n');
  const before = new Set(((await api(page, 'GET', '/api/import/batches')).body.batches as Array<{ id: string }>).map((b) => b.id));

  try {
    await page.goto('/teacher/import');
    const ip = page.getByTestId('import-page');
    await expect(ip).toBeVisible();
    // Local processing / OCR notice is always visible (IMP-7).
    await expect(page.getByTestId('import-ocr-notice')).toContainText('text recognition');
    await ip.getByLabel('Import into class').selectOption({ label: '3-A' });
    await ip.getByLabel('Student list').fill(list);
    await ip.getByRole('button', { name: 'Preview' }).click();

    const preview = page.getByTestId('import-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('status')).toHaveText('3 to add, 0 existing, 0 skipped');
    // Names are kept whole and title-cased; headings are hidden by default.
    await expect(preview.getByRole('row').filter({ hasText: `Arda Kurgu${tag}` })).toBeVisible();
    await expect(preview.getByRole('row').filter({ hasText: 'Öğrenci Listesi' })).toHaveCount(0);

    // Fix a row in the preview.
    await preview.getByRole('row').filter({ hasText: `Mira Kurgu${tag}` }).getByRole('button', { name: /^Row \d+$/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Full name').fill(`Mira Su Kurgu${tag}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    const fixed = preview.getByRole('row').filter({ hasText: `Mira Su Kurgu${tag}` });
    await expect(fixed).toContainText('Edited');
    await new AxeBuilder({ page }).include('[data-testid="import-page"]').analyze().then((r) => expect(r.violations).toEqual([]));

    await preview.getByRole('button', { name: 'Confirm: add 3, link 0' }).click();
    const report = page.getByTestId('import-report');
    await expect(report).toBeVisible();
    await expect(report.getByRole('status')).toHaveText('3 added, 0 existing, 1 skipped, 0 not possible');
    await expect(report.getByRole('row').filter({ hasText: `Mira Su Kurgu${tag}` })).toContainText('Added');

    // Re-import the same list: matched by student number, nothing added twice (IMP-5).
    await report.getByRole('button', { name: 'Import another list' }).click();
    await ip.getByLabel('Import into class').selectOption({ label: '3-A' });
    await ip.getByLabel('Student list').fill(list);
    await ip.getByRole('button', { name: 'Preview' }).click();
    await expect(preview.getByRole('status')).toHaveText('0 to add, 3 existing, 0 skipped');
    await expect(preview.getByRole('row').filter({ hasText: `Defne Kurgu${tag}` })).toContainText('Same number: existing student');
    await preview.getByRole('button', { name: 'Confirm: add 0, link 3' }).click();
    await expect(report.getByRole('status')).toHaveText('0 added, 3 existing, 1 skipped, 0 not possible');
    await expect(report.getByRole('row').filter({ hasText: `Defne Kurgu${tag}` })).toContainText('Already in this class');

    const roster = await api(page, 'GET', `/api/import/batches`);
    expect((roster.body.batches as Array<{ status: string; id: string }>).filter((b) => !before.has(b.id) && b.status === 'committed')).toHaveLength(2);
  } finally {
    // Undo this test's imports (the added students have no records, so they are removed).
    await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN });
    const mine = ((await api(page, 'GET', '/api/import/batches')).body.batches as Array<{ id: string; status: string }>).filter((b) => !before.has(b.id) && b.status === 'committed');
    for (const b of mine) await api(page, 'POST', `/api/import/batches/${b.id}/revert`, { confirm: true });
  }
});
