/**
 * Students' own avatar pictures end to end (S24, D-184). Fictional demo data and a picture drawn by the
 * test only (a coloured square with a star; no person).
 * - The administrator turns the school switch on; the teacher lets 3-A send pictures.
 * - A student on a 375 px phone opens "Use my own picture", chooses the drawing, moves and turns it in
 *   the editor and sends it; the teacher refuses it with a reason, which the phone shows.
 * - The student sends another; the teacher ticks the confirmation and approves; the picture shows on
 *   the student's classroom card.
 * - The Super Speakers board shows the catalogue avatar until "Show students' own pictures" is on.
 * - axe at 375 px (phone) and 1536×703 (teacher page). Every switch is put back in `finally`.
 */
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

const serious = async (page: Page, include: string) =>
  (await new AxeBuilder({ page }).include(include).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }] });
  }
}

/** Draws the fictional test picture in the phone's browser and returns it as a PNG file. */
async function drawPicture(p: Page, colour: string) {
  const dataUrl = await p.evaluate((fill) => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const g = c.getContext('2d')!;
    g.fillStyle = fill;
    g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#ffd34d';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 90 : 220;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      g.lineTo(400 + r * Math.cos(a), 300 + r * Math.sin(a));
    }
    g.fill();
    return c.toDataURL('image/png');
  }, colour);
  return { name: 'my-star.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') };
}

/** On the phone: open "Use my own picture", choose the drawing, edit it and send it. */
async function sendPicture(p: Page, colour: string, checkAxe: boolean) {
  const screen = p.getByTestId('avatar-picture-screen');
  await expect(screen).toBeVisible();
  if (checkAxe) {
    expect(await serious(p, '[data-testid="avatar-picture-screen"]')).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await screen.getByTestId('picture-file').setInputFiles(await drawPicture(p, colour));
  const editor = p.getByTestId('picture-editor');
  await expect(editor).toBeVisible();
  const stage = editor.getByTestId('picture-stage');
  await stage.focus();
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  await editor.getByTestId('picture-turn-right').click();
  await editor.getByTestId('picture-zoom').fill('150');
  if (checkAxe) {
    expect(await serious(p, '[data-testid="picture-editor"]')).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const sent = p.waitForResponse((r) => r.url().endsWith('/api/student/avatar-picture') && r.request().method() === 'POST');
  await editor.getByTestId('picture-send').click();
  expect((await sent).status()).toBe(200);
  await expect(p.getByTestId('picture-waiting')).toBeVisible();
}

const newSignedIn = async (browser: Browser, user: string) => {
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 703 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  await login(page, user);
  return { ctx, page };
};

test('a student sends their own picture; the teacher refuses with a reason, then approves; the board waits for the setting', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const admin = await newSignedIn(browser, 'admin');
  const policies = (await api(admin.page, 'GET', '/api/admin/module-policies')).body.policies as Array<{ module: string; availability: string }>;
  const speakersBefore = policies.find((x) => x.module === 'superSpeakers')?.availability ?? 'disabled';
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  const ctx = mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  const student = roster[12]!;
  const links = (await api(page, 'GET', `/api/teacher/classes/${ctx.classId}/student-links`)).body.students as Array<{ id: string; link: { url: string | null } | null }>;
  const link = links.find((s) => s.id === student.id)!.link!.url!;
  const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const phone = await phoneCtx.newPage();
  try {
    expect((await api(admin.page, 'PUT', '/api/admin/module-policies/media.avatarPictures', { availability: 'enabled' })).status).toBe(200);
    expect((await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/avatar-settings`, { uploads: true })).status).toBe(200);

    // The phone: My avatar → Use my own picture → the editor → Send to my teacher.
    await phone.goto(link);
    await phone.getByRole('link', { name: 'My avatar' }).click();
    await phone.getByTestId('avatar-picture-open').click();
    await sendPicture(phone, '#3a7bd5', true);

    // The teacher: the menu tile counts it; "Not this one" needs a reason.
    await page.goto('/teacher');
    const tile = page.getByTestId('menu-today').getByRole('link', { name: /Avatar pictures/u });
    await expect(tile).toContainText('1');
    await tile.click();
    const review = page.getByTestId('avatar-pictures-page');
    await expect(review).toBeVisible();
    let item = review.getByTestId('picture-to-check').filter({ hasText: student.fullName });
    await expect(item).toBeVisible();
    await page.setViewportSize({ width: 1536, height: 703 });
    expect(await serious(page, '[data-testid="avatar-pictures-page"]')).toEqual([]);
    await item.getByTestId('picture-refuse').click();
    await expect(item.getByTestId('picture-refuse-send')).toBeDisabled();
    await item.getByTestId('picture-reason-namePlace').check();
    expect(await serious(page, '[data-testid="avatar-pictures-page"]')).toEqual([]);
    await item.getByTestId('picture-refuse-send').click();
    await expect(review.getByTestId('picture-to-check').filter({ hasText: student.fullName })).toHaveCount(0);

    // The phone shows the reason; the picture is already deleted.
    await phone.reload();
    await expect(phone.getByTestId('picture-refused-reason')).toHaveText('It shows a name or a place.');
    expect(await serious(phone, '[data-testid="avatar-picture-screen"]')).toEqual([]);
    await phone.getByTestId('picture-choose-another-after-refusal').click();
    await sendPicture(phone, '#2f9e6f', false);

    // The teacher approves: the confirmation tick first.
    await page.reload();
    item = review.getByTestId('picture-to-check').filter({ hasText: student.fullName });
    await expect(item.getByTestId('picture-approve')).toBeDisabled();
    await item.getByTestId('picture-confirm').check();
    await item.getByTestId('picture-approve').click();
    await expect(review.getByTestId('picture-to-check').filter({ hasText: student.fullName })).toHaveCount(0);
    await review.getByRole('tab', { name: /^In use/u }).click();
    await expect(review.getByTestId('picture-in-use-item').filter({ hasText: student.fullName })).toBeVisible();
    await phone.reload();
    await expect(phone.getByTestId('picture-in-use')).toBeVisible();

    // The classroom card shows the picture.
    const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true } }] });
    expect(started.body.results[0].ok).toBe(true);
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/classroom');
      await page.getByRole('button', { name: /3-A · English/ }).click();
      const card = page.locator('article.cc-student-card', { hasText: student.fullName }).first();
      await expect(card.locator('[data-avatar="picture"] img')).toBeVisible();
      expect(await card.locator('[data-avatar="picture"] img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    } finally {
      await endActiveLessons(page);
    }

    // Super Speakers: the board shows the catalogue avatar until the administrator turns pictures on.
    expect((await api(admin.page, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: 'enabled' })).status).toBe(200);
    const awards = (await api(admin.page, 'GET', '/api/admin/speakers/awards?includeVoided=0')).body.awards as Array<{ id: string }>;
    for (const a of awards) expect((await api(admin.page, 'POST', `/api/admin/speakers/awards/${a.id}/void`, { reason: 'e2e clean start' })).status).toBe(200);
    const stamp = Date.now().toString(36);
    expect((await api(admin.page, 'POST', '/api/admin/speakers/scorers', { label: `Pictures ${stamp}` })).status).toBe(200);
    expect((await api(admin.page, 'POST', '/api/admin/speakers/displays', { label: `Pictures hall ${stamp}` })).status).toBe(200);
    const overview = (await api(admin.page, 'GET', '/api/admin/speakers')).body;
    const scorerUrl = overview.scorerLinks.find((l: { label: string }) => l.label === `Pictures ${stamp}`).url as string;
    const boardUrl = overview.displayLinks.find((l: { label: string }) => l.label === `Pictures hall ${stamp}`).url as string;
    const scorerCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-GB' });
    const boardCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-GB' });
    try {
      const scorer = await scorerCtx.newPage();
      await scorer.goto(scorerUrl);
      await expect(scorer).toHaveURL(/\/p$/u);
      // The address bar loses the token before the link is exchanged for the scorer cookie: wait for
      // the paired app (or its start screen), not the URL, before using the cookie.
      await expect(scorer.getByTestId('scorer-start').or(scorer.getByTestId('scorer-app'))).toBeVisible();
      const given = await api(scorer, 'POST', '/api/scorer/commands', { commands: [{ opId: randomUUID(), type: 'points.award', payload: { studentId: student.id } }] });
      expect(given.body.results[0].ok).toBe(true);
      const board = await boardCtx.newPage();
      await board.goto(boardUrl);
      const place = board.getByTestId('board-place-1');
      await expect(place).toContainText(student.fullName);
      await expect(place.locator('.cc-avatar').first()).toBeVisible();
      await expect(place.locator('[data-avatar="picture"]')).toHaveCount(0);
      expect((await api(admin.page, 'PUT', '/api/admin/speakers/settings', { showOwnPictures: true })).status).toBe(200);
      await board.reload();
      await expect(place.locator('[data-avatar="picture"] img')).toBeVisible();
    } finally {
      await api(admin.page, 'PUT', '/api/admin/speakers/settings', { showOwnPictures: false });
      const left = (await api(admin.page, 'GET', '/api/admin/speakers/awards?includeVoided=0')).body.awards as Array<{ id: string }>;
      for (const a of left) await api(admin.page, 'POST', `/api/admin/speakers/awards/${a.id}/void`, { reason: 'e2e clean end' });
      await scorerCtx.close();
      await boardCtx.close();
    }
  } finally {
    // Everything back as it was: the picture removed, the class and school switches off.
    const list = (await api(admin.page, 'GET', '/api/admin/avatar-pictures')).body as { toCheck: Array<{ id: string; studentId: string }>; inUse: Array<{ id: string; studentId: string }> } | null;
    for (const x of [...(list?.toCheck ?? []), ...(list?.inUse ?? [])].filter((x) => x.studentId === student.id)) await api(admin.page, 'DELETE', `/api/admin/avatar-pictures/${x.id}`, {});
    await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/avatar-settings`, { uploads: false });
    await api(admin.page, 'PUT', '/api/admin/module-policies/media.avatarPictures', { availability: 'disabled' });
    await api(admin.page, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: speakersBefore });
    await phoneCtx.close();
    await admin.ctx.close();
  }
});
