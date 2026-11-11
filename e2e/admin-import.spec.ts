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

/**
 * Several classes in one file (S20c, D-171; IMP-2): a school list with a class column is shown as one
 * preview of all its classes (rows per class, Turkish-aware class names, an unknown class with a
 * choice); each class then gets its own draft, confirmed on its own. Fictional names only.
 */
test('an administrator splits a list with several classes into its classes in one preview', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  const years = (await api(page, 'GET', '/api/admin/years')).body.years as Array<{ id: string; archived: boolean; startsOn: string }>;
  const year = years.filter((y) => !y.archived).sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]!;
  const tag = letters();
  // Two classes of grade 9 with distinct one-letter branches (written three ways in the file).
  const [k, m] = [...new Set(tag.toUpperCase())] as [string, string];
  test.skip(!m, 'the random tag needs two different letters');
  const ids: string[] = [];
  for (const branch of [k, m]) {
    const created = await api(page, 'POST', '/api/admin/classes', { schoolYearId: year.id, name: `9-${branch}`, grade: 9 });
    expect(created.status).toBe(200);
    ids.push(created.body.id as string);
  }
  const csv = [
    'Öğrenci No;Adı;Soyadı;Sınıfı/Şubesi',
    `8101;Deniz;Örnek${tag};9/${k}`,
    `8102;Irmak;Kurgu${tag};9 ${k}`,
    `8103;Ada;Deneme${tag};9. Sınıf / ${m} Şubesi`,
    `8104;Efe;Taslak${tag};11/Ş`,
    '',
  ].join('\n');
  try {
    await page.goto('/admin/import');
    const ap = page.getByTestId('admin-import-page');
    await ap.getByRole('switch', { name: 'This list has several classes' }).click({ force: true });
    await expect(ap.getByLabel('Import into class')).toHaveCount(0);
    await ap.getByLabel('Choose a file').setInputFiles({ name: 'okul-listesi.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await ap.getByRole('button', { name: 'Read file' }).click();

    const split = page.getByTestId('import-split-preview');
    await expect(split.getByRole('heading', { name: 'Classes in this list' })).toBeVisible();
    const table = split.getByRole('table', { name: 'Classes in the list (3)' });
    const rowK = table.getByRole('row').filter({ hasText: `9/${k}` });
    await expect(rowK).toContainText(`9 ${k}`);
    await expect(rowK).toContainText('2 rows');
    await expect(rowK).toContainText(`Class 9-${k}`);
    const rowM = table.getByRole('row').filter({ hasText: `${m} Şubesi` });
    await expect(rowM).toContainText('1 row');
    await expect(rowM).toContainText(`Class 9-${m}`);
    const unknown = table.getByRole('row').filter({ hasText: '11/Ş' });
    // An administrator is told the school has no such class (a teacher: "Not one of your classes").
    await expect(unknown).toContainText('No class with this name');
    await expect(split.getByRole('status').filter({ hasText: 'Rows to import' })).toHaveText('Rows to import: 3, into 2 classes. Rows skipped: 1.');
    await new AxeBuilder({ page }).include('[data-testid="admin-import-page"]').analyze().then((r) => expect(r.violations).toEqual([]));
    // The unknown class can be put into a class: then every row is imported.
    await unknown.getByLabel('Import “11/Ş” into').selectOption(ids[1]!);
    await expect(split.getByRole('status').filter({ hasText: 'Rows to import' })).toHaveText('Rows to import: 4, into 2 classes. Rows skipped: 0.');
    await split.getByRole('button', { name: 'Make previews for 2 classes' }).click();

    // One draft per class, each checked and confirmed on its own.
    const batches = page.getByTestId('import-split-batches');
    await expect(batches.getByRole('status')).toHaveText('2 classes still to check and confirm.');
    const preview = page.getByTestId('import-preview');
    const report = page.getByTestId('import-report');
    for (const [branch, left] of [
      [k, '1 class still to check and confirm.'],
      [m, 'Every class from this list has been handled.'],
    ] as const) {
      await batches.getByRole('button', { name: `Check 9-${branch}` }).click();
      await expect(preview.getByRole('heading', { name: new RegExp(`9-${branch}`, 'u') })).toBeVisible();
      await expect(preview.getByRole('status').filter({ hasText: /to add/ })).toHaveText('2 to add, 0 existing, 0 skipped');
      await preview.getByRole('button', { name: 'Confirm: add 2, link 0' }).click();
      await expect(report.getByRole('status')).toContainText('2 added');
      await report.getByRole('button', { name: 'Import another list' }).click();
      await expect(batches.getByRole('status')).toHaveText(left);
    }
    await batches.getByRole('button', { name: 'Back to the start' }).click();
    await expect(ap.getByRole('switch', { name: 'This list has several classes' })).toBeVisible();
  } finally {
    const all = (await api(page, 'GET', '/api/import/batches')).body.batches as Array<{ id: string; classId: string; status: string }>;
    for (const b of all.filter((x) => ids.includes(x.classId) && x.status === 'committed')) await api(page, 'POST', `/api/import/batches/${b.id}/revert`, { confirm: true });
    for (const id of ids) await api(page, 'POST', `/api/admin/classes/${id}/archive`, {});
  }
});
