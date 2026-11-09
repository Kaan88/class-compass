/**
 * Notifications and the teacher menu (S14e3, D-155, D-156). Fictional demo data only; module switches
 * the test changes are put back in `finally`.
 * - A student adds a goal on their page → the bell shows 1 → the notifications page lists it under the
 *   student → "Open" deep-links to the student's goals (and marks it read); axe on the list and settings.
 * - The menu: Today tiles, one Class setup tile and its hub with tabs; a module switched off in every
 *   class of the teacher hides its tile, and its old address shows an empty state; axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

type Ctx = { id: string; classId: string; className: string; subjectId: string; subjectName: { en: string }; modules: Record<string, boolean> };
const contextsOf = async (page: Page) => (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];

test('a student adds a goal: the bell shows 1, the page lists it, Open goes to the student’s goals', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const c3a = (await contextsOf(page)).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${c3a.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[3]!;
  const link = await studentLinkUrl(page, c3a.classId, student.id);
  // Start from nothing new.
  expect((await api(page, 'POST', '/api/teacher/notifications/read', { all: true })).status).toBe(200);
  await page.goto('/teacher');
  await expect(page.getByTestId('teacher-menu')).toBeVisible();
  await expect(page.getByTestId('bell')).toHaveAttribute('aria-label', 'Notifications');

  // The student's phone.
  const phone = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Istanbul' });
  const sp = await phone.newPage();
  try {
    await sp.goto(link);
    await expect(sp.getByTestId('student-page')).toBeVisible();
    const pageData = (await api(sp, 'GET', '/api/student/page')).body;
    const goals = pageData.subjects.find((s: any) => s.name.en === 'English').sections.find((x: any) => x.key === 'goals').data;
    const r = await api(sp, 'POST', '/api/student/goals', { subjectId: c3a.subjectId, categoryId: goals.categories[0].id, text: 'I will read a book about planets every week.' });
    expect(r.status).toBe(200);
  } finally {
    await phone.close();
  }

  // The bell picks it up (reload instead of waiting for the 60 s poll).
  await page.reload();
  await expect(page.getByTestId('bell')).toHaveAttribute('aria-label', 'Notifications: 1 new');
  await expect(page.getByTestId('bell-tile')).toContainText('1');
  await page.getByTestId('bell').click();
  await expect(page).toHaveURL(/\/teacher\/notifications/u);
  const card = page.getByTestId('notification-student').filter({ hasText: student.fullName });
  await expect(card).toBeVisible();
  const item = card.getByTestId('notification-item').first();
  await expect(item).toContainText('Added a new goal');
  await expect(item).toContainText('I will read a book about planets every week.');
  await expect(item).toContainText('New');
  expect(await seriousViolations(page)).toEqual([]);

  // The student's name opens the statistics drawer (S14e2).
  await card.getByTestId('student-name').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await item.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`/teacher/goals\\?.*studentId=${student.id}`, 'u'));
  await expect(page.getByTestId('teacher-student-goals').getByRole('heading', { name: student.fullName })).toBeVisible();
  await expect(page.getByTestId('bell')).toHaveAttribute('aria-label', 'Notifications');

  // Settings: categories and the daily email (off by default); axe.
  await page.goto('/teacher/notifications?tab=settings');
  await expect(page.getByRole('switch', { name: 'Send me a daily email' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'New goals' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Avatars changed' })).not.toBeChecked();
  expect(await seriousViolations(page)).toEqual([]);
});

test('teacher menu: Today tiles, one Class setup hub, and pages of modules that are off everywhere are hidden', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/teacher');
  const today = page.getByTestId('menu-today');
  await expect(today.locator('a.cc-menu-tile')).toHaveText(['Attendance', 'Homework', 'Goals', 'Reports', /^Notifications/u]);
  await expect(page.getByTestId('teacher-menu').getByRole('link', { name: 'Profile and PIN' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByTestId('menu-setup').getByRole('link', { name: 'Class setup' }).click();
  const hub = page.getByTestId('setup-hub');
  await expect(hub.getByRole('tab')).toHaveText(['Classes and students', 'Lesson tools', 'Achievements and kind words']);
  await expect(hub.getByRole('tabpanel').getByRole('link', { name: 'Class settings' })).toBeVisible();
  await hub.getByRole('tab', { name: 'Lesson tools' }).click();
  await expect(page).toHaveURL(/tab=lessons/u);
  await expect(hub.getByRole('tabpanel').getByRole('link', { name: 'Counters' })).toBeVisible();
  // The nav marks Class setup on every setup page.
  await hub.getByRole('tabpanel').getByRole('link', { name: 'Counters' }).click();
  await expect(page.locator('.cc-teacher-nav__links a[data-section="current"]')).toHaveText('Class setup');
  expect(await seriousViolations(page)).toEqual([]);

  // Homework off in every class+subject of this teacher: no tile, no nav link, the address shows an empty state.
  const before = await contextsOf(page);
  try {
    for (const c of before) expect((await api(page, 'PUT', `/api/teacher/contexts/${c.id}/modules/homework`, { enabled: false })).status).toBe(200);
    await page.goto('/teacher');
    await expect(today.locator('a.cc-menu-tile')).toHaveText(['Attendance', 'Goals', 'Reports', /^Notifications/u]);
    await page.goto('/teacher/homework');
    await expect(page.getByTestId('module-off-page')).toBeVisible();
    await expect(page.getByText('Homework is switched off in all your classes')).toBeVisible();
    await expect(page.locator('.cc-teacher-nav__links').getByRole('link', { name: 'Homework' })).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole('link', { name: 'Open Class settings' }).click();
    await expect(page).toHaveURL(/\/teacher\/classes/u);
  } finally {
    for (const c of before) await api(page, 'PUT', `/api/teacher/contexts/${c.id}/modules/homework`, { enabled: c.modules.homework !== false });
  }
  await page.goto('/teacher');
  await expect(today.locator('a.cc-menu-tile')).toHaveText(['Attendance', 'Homework', 'Goals', 'Reports', /^Notifications/u]);
});
