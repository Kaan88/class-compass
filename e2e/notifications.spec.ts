/**
 * Notifications and the teacher menu (S14e3, D-155, D-156). Fictional demo data only; module switches
 * the test changes are put back in `finally`.
 * - A student adds a goal on their page → the bell shows 1 → the notifications page lists it under the
 *   student → "Open" deep-links to the student's goals (and marks it read); with a filter on, "Mark
 *   these as read" replaces "Mark all as read"; axe on the list and settings.
 * - The menu: Today tiles, one Class setup tile and its hub with tabs; a module switched off in every
 *   class of the teacher hides its tile, and its old address shows an empty state (which says so when
 *   the administrator turned the module off school-wide); axe.
 * - Open preselects (S14i): the achievements dialog opens once for the linked student; avatars, student
 *   links and the kind words check choose the class and mark the student's row (aria-current). The
 *   blocked word and the notice switch are put back in `finally`.
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

  // With a filter on, the button marks only the lines shown, and only shows when some are new.
  const list = page.getByTestId('notifications-page');
  await expect(list.getByRole('button', { name: 'Mark all as read' })).toBeVisible();
  await list.getByLabel('Kind').selectOption({ label: 'Goals and reflections' });
  await expect(list.getByRole('button', { name: 'Mark these as read' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0);
  await list.getByLabel('Kind').selectOption({ label: 'Avatars, links and kind words' });
  await list.getByLabel('Show').selectOption({ label: 'New only' });
  await expect(list.getByText('Nothing matches these filters.')).toBeVisible();
  await expect(list.getByRole('button', { name: /^Mark (these|all) as read$/u })).toHaveCount(0);
  await list.getByLabel('Show').selectOption({ label: 'All' });
  await list.getByLabel('Kind').selectOption({ label: 'All kinds' });

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

test('teacher menu: Today tiles, one Class setup hub, and pages of modules that are off everywhere are hidden', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/teacher');
  const today = page.getByTestId('menu-today');
  await expect(today.locator('a.cc-menu-tile')).toHaveText(['Attendance', 'Homework', 'Goals', 'Reports', /^Notifications/u, 'Assistant']);
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
  // Not by colour alone: said to screen readers and underlined (S14e3 review).
  await expect(page.locator('.cc-teacher-nav__links').getByRole('link', { name: 'Class setup' })).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.cc-teacher-nav__links a[data-section="current"]')).toHaveCSS('text-decoration-line', 'underline');
  expect(await seriousViolations(page)).toEqual([]);

  // Homework off in every class+subject of this teacher: no tile, no nav link, the address shows an empty state.
  const before = await contextsOf(page);
  try {
    for (const c of before) expect((await api(page, 'PUT', `/api/teacher/contexts/${c.id}/modules/homework`, { enabled: false })).status).toBe(200);
    await page.goto('/teacher');
    await expect(today.locator('a.cc-menu-tile')).toHaveText(['Attendance', 'Goals', 'Reports', /^Notifications/u, 'Assistant']);
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
  await expect(today.locator('a.cc-menu-tile')).toHaveText(['Attendance', 'Homework', 'Goals', 'Reports', /^Notifications/u, 'Assistant']);

  // Homework made unavailable school-wide by the administrator: the page says so and offers no Class
  // settings switch the teacher could not use (S14e3 review).
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  try {
    await login(admin, 'admin');
    const was = ((await api(admin, 'GET', '/api/admin/module-policies')).body.policies as Array<{ module: string; availability: string }>).find((p) => p.module === 'homework')!.availability;
    try {
      expect((await api(admin, 'PUT', '/api/admin/module-policies/homework', { availability: 'disabled' })).status).toBe(200);
      await page.goto('/teacher/homework');
      await expect(page.getByTestId('module-off-page')).toBeVisible();
      await expect(page.getByText('Homework is turned off by your administrator')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open Class settings' })).toHaveCount(0);
      expect(await seriousViolations(page)).toEqual([]);
    } finally {
      await api(admin, 'PUT', '/api/admin/module-policies/homework', { availability: was });
    }
  } finally {
    await adminCtx.close();
  }
});

test('Open links preselect: the achievements dialog opens once, the class lists mark the student (S14i, D-155)', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const contexts = await contextsOf(page);
  // A class+subject that is not the page's default choice, so the preselection is what picks it.
  const target = contexts.filter((c) => c.classId !== contexts[0]!.classId).at(-1)!;
  expect(target).toBeTruthy();
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${target.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[2]!;
  const classSelect = page.getByRole('main').getByLabel('Class', { exact: true });

  // Achievements: the student's dialog opens; once closed, it does not come back when the tab remounts.
  await page.goto(`/teacher/achievements?contextId=${target.id}&studentId=${student.id}`);
  const dialog = page.getByTestId('achievements-student-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: student.fullName })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(classSelect).toHaveValue(target.id);
  await page.getByRole('tab', { name: 'All achievements' }).click();
  await page.getByRole('tab', { name: 'Students and settings' }).click();
  await expect(page.getByTestId('achievements-student-open').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await classSelect.selectOption(contexts[0]!.id);
  await classSelect.selectOption(target.id);
  await expect(page.getByTestId('achievements-student-open').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Avatars and student links: the class is chosen and the student's row is marked.
  await page.goto(`/teacher/avatars?classId=${target.classId}&studentId=${student.id}`);
  await expect(classSelect).toHaveValue(target.classId);
  const avatarRow = page.getByTestId('avatars-page').locator('li[aria-current="true"]');
  await expect(avatarRow).toHaveCount(1);
  await expect(avatarRow).toContainText(student.fullName);
  await page.goto(`/teacher/student-links?classId=${target.classId}&studentId=${student.id}`);
  await expect(classSelect).toHaveValue(target.classId);
  const linkRow = page.locator('[data-testid="link-row"][aria-current="true"]');
  await expect(linkRow).toHaveCount(1);
  await expect(linkRow).toContainText(student.fullName);

  // Kind words check: the student tries a word the teacher blocked; with the notice on, their row is marked.
  const words = (await api(page, 'GET', '/api/teacher/text-check-words')).body.block as string[];
  const notice = `/api/teacher/contexts/${target.id}/blocked-text`;
  const noticeWas = (await api(page, 'GET', notice)).body.enabled as boolean;
  const phone = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Istanbul' });
  try {
    expect((await api(page, 'PUT', '/api/teacher/text-check-words', { block: [...words, 'zorblat'] })).status).toBe(200);
    expect((await api(page, 'PUT', notice, { enabled: true })).status).toBe(200);
    const sp = await phone.newPage();
    await sp.goto(await studentLinkUrl(page, target.classId, student.id));
    await expect(sp.getByTestId('student-page')).toBeVisible();
    const pageData = (await api(sp, 'GET', '/api/student/page')).body;
    const goals = pageData.subjects.find((s: any) => s.name.en === target.subjectName.en).sections.find((x: any) => x.key === 'goals').data;
    const r = await api(sp, 'POST', '/api/student/goals', { subjectId: target.subjectId, categoryId: goals.categories[0].id, text: 'I will zorblat every single day.' });
    expect(r.body.error.details.reason).toBe('TEXT_BLOCKED_WORD');
    await page.goto(`/teacher/text-checks?contextId=${target.id}&studentId=${student.id}`);
    await expect(classSelect).toHaveValue(target.id);
    const marked = page.getByTestId('text-checks-page').locator('li[aria-current="true"]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText(student.fullName);
  } finally {
    await phone.close();
    await api(page, 'PUT', '/api/teacher/text-check-words', { block: words });
    await api(page, 'PUT', notice, { enabled: noticeWas });
  }
});
