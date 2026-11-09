/**
 * Theme packages (S14g, D-158; THM-2, THM-3, UX-6): an administrator imports the worked example with
 * one colour that fails contrast, sees the error, fixes it in the page, previews, saves the draft and
 * enables it; a teacher chooses it for 3-A and the classroom display uses its tokens (axe on the
 * classroom and the admin page); deleting it moves the class back to the default theme. Fictional data
 * only; the demo data is put back afterwards.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_THEME } from '../src/shared/themes.ts';
import { api, ensurePin, login } from './helpers.ts';

const OCEAN = readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', 'ocean.theme.json'), 'utf8');

async function seriousViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
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
