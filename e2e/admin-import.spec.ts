/**
 * Admin → Import students (S16a, D-163; IMP-1, IMP-2, IMP-5): an administrator picks an empty class
 * of the school year, reads a fictional CSV, confirms, sees the class filled and undoes the import.
 * The test class is archived at the end so the demo data stays as it was. Fictional names only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, login } from './helpers.ts';

const TAG_LETTERS = 'abcdefghjklmnoprstuvyz';
const letters = () => Array.from({ length: 4 }, () => TAG_LETTERS[Math.floor(Math.random() * TAG_LETTERS.length)]).join('');

test('an administrator fills an empty class from a CSV and undoes it @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  const years = (await api(page, 'GET', '/api/admin/years')).body.years as Array<{ id: string; archived: boolean; startsOn: string }>;
  const year = years.filter((y) => !y.archived).sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]!;
  const tag = letters();
  const className = `9-${tag.toUpperCase()}`;
  const created = await api(page, 'POST', '/api/admin/classes', { schoolYearId: year.id, name: className, grade: null });
  expect(created.status).toBe(200);
  const classId = created.body.id as string;
  const csv = ['Öğrenci No,Adı Soyadı', `7101,Deniz Örnek${tag}`, `7102,Irmak Kurgu${tag}`, `7103,Ada Deneme${tag}`, ''].join('\n');
  try {
    await page.goto('/admin/import');
    const ap = page.getByTestId('admin-import-page');
    await expect(ap.getByRole('heading', { name: 'Import student lists' })).toBeVisible();
    // The new class is listed as empty, in words.
    const classRow = ap.getByRole('table', { name: 'Classes of the open school years and how many students each has' }).getByRole('row').filter({ hasText: className });
    await expect(classRow).toContainText('Empty');
    await new AxeBuilder({ page }).include('[data-testid="admin-import-page"]').analyze().then((r) => expect(r.violations).toEqual([]));

    // The page starts on an empty class; choose ours unless it is already the chosen one.
    const choose = classRow.getByRole('button', { name: `Import into ${className}` });
    if (await choose.isEnabled()) await choose.click();
    await expect(choose).toBeDisabled();
    await ap.getByLabel('Choose a file').setInputFiles({ name: 'sinif-listesi.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await ap.getByRole('button', { name: 'Read file' }).click();
    const preview = page.getByTestId('import-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('status').filter({ hasText: /to add/ })).toHaveText('3 to add, 0 existing, 0 skipped');
    await new AxeBuilder({ page }).include('[data-testid="admin-import-page"]').analyze().then((r) => expect(r.violations).toEqual([]));
    await preview.getByRole('button', { name: 'Confirm: add 3, link 0' }).click();
    const report = page.getByTestId('import-report');
    await expect(report.getByRole('status')).toContainText('3 added');
    await expect(ap.getByTestId('admin-import-busy')).toBeVisible();
    await expect(classRow).toContainText('3');
    await expect(classRow).not.toContainText('Empty');

    // The history shows the class and the administrator; undo works for an admin batch.
    const history = ap.getByRole('table', { name: 'All imports in the school' });
    const batchRow = history.getByRole('row').filter({ hasText: className });
    await batchRow.getByRole('button', { name: 'Undo import' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('textbox').fill(className);
    await dialog.getByRole('button', { name: 'Undo import' }).click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Import undone' })).toBeVisible();
    await expect(classRow).toContainText('Empty');
  } finally {
    const batches = ((await api(page, 'GET', '/api/import/batches')).body.batches as Array<{ id: string; classId: string; status: string }>).filter((b) => b.classId === classId && b.status === 'committed');
    for (const b of batches) await api(page, 'POST', `/api/import/batches/${b.id}/revert`, { confirm: true });
    await api(page, 'POST', `/api/admin/classes/${classId}/archive`, {});
  }
});
