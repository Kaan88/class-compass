/**
 * S27a (D-193, GOL-4, D-014) in the browser, fictional demo data only:
 * - The administrator switches "Video evidence" on (Admin → Modules → Photos and media); it is off by
 *   default, so the student page offers no video choices before.
 * - A student adds a short video made in the test (a few coloured canvas frames recorded with
 *   MediaRecorder: nothing personal in it) with "Add a video", and records one with the in-page
 *   recorder and Chromium's fake camera ("Record a video": timer, Stop, Use this video).
 * - The teacher opens the student on the Goals page and plays the video: it is served with byte
 *   ranges (206) and plays. Axe on the evidence lists; on a phone "Record a video" is the in-page
 *   recorder too, with the camera app (capture input in video mode) as a second choice.
 * - The recorded clip plays back in its own player before "Use this video" (not the stopped camera).
 * The switch is put back off in `finally` (one shared e2e server), and the evidence is deleted.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { api, ensurePin, login, PASSWORD, studentLinkUrl } from './helpers.ts';

type Ctx = { id: string; classId: string; className: string; subjectName: { en: string } };
type Rostered = { id: string; fullName: string };

async function seriousViolations(page: Page, include?: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  // Captions are not required for the students' own short videos (owner, D-193); the words under a
  // video describe it. Every other rule applies.
  const builder = new AxeBuilder({ page }).disableRules(['video-caption']);
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function englishContext(page: Page): Promise<Ctx> {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  return mine.find((c) => c.className === '3-B' && c.subjectName.en === 'English')!;
}

/** Admin session in its own context. */
async function withAdmin<T>(browser: Browser, fn: (admin: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext();
  try {
    const admin = await ctx.newPage();
    await login(admin, 'admin', PASSWORD);
    return await fn(admin);
  } finally {
    await ctx.close();
  }
}
const videoSwitch = (browser: Browser, on: boolean) =>
  withAdmin(browser, async (admin) => {
    expect((await api(admin, 'PUT', '/api/admin/module-policies/media.evidenceVideo', { availability: on ? 'enabled' : 'disabled' })).status).toBe(200);
  });

async function showMyWork(p: Page): Promise<{ form: Locator; workUrl: string }> {
  await expect(p.getByTestId('student-page')).toBeVisible();
  const subjects = p.getByRole('group', { name: 'My subject' });
  if (await subjects.count()) await subjects.getByRole('button', { name: 'English', exact: true }).click();
  await p.getByRole('link', { name: 'Show my work' }).click();
  const form = p.getByTestId('evidence-form');
  await expect(form).toHaveAttribute('data-step', 'how');
  return { form, workUrl: p.url() };
}
async function chooseKind(form: Locator, kind: string) {
  await expect(form).toHaveAttribute('data-step', 'how');
  await form.getByRole('button', { name: kind, exact: true }).click();
  await expect(form).not.toHaveAttribute('data-step', 'how');
  if ((await form.getAttribute('data-step')) === 'goal') await form.getByRole('button', { name: 'For all my learning' }).click();
  await expect(form.getByRole('button', { name: /^(Save my work|Add \d+ items)$/u })).toBeVisible();
}

/** A ~1 s WebM of changing colours, recorded from a canvas in the page (synthetic, shows nothing personal). */
async function syntheticVideo(p: Page): Promise<Buffer> {
  const b64 = await p.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const g = canvas.getContext('2d')!;
    const stream = canvas.captureStream(15);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    let i = 0;
    const paint = setInterval(() => {
      g.fillStyle = `hsl(${(i * 40) % 360} 60% 50%)`;
      g.fillRect(0, 0, 160, 120);
      i += 1;
    }, 50);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(200);
    await new Promise((r) => setTimeout(r, 1200));
    rec.stop();
    await stopped;
    clearInterval(paint);
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

test('the admin switches video on; a student adds and records videos; the teacher plays them (D-193)', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'the in-page recorder needs a fine pointer; the phone variant runs below');
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page);
  const student = ((await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Rostered[])[13]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false, locale: 'en-GB', permissions: ['camera', 'microphone'] });
  const added: string[] = [];
  try {
    const p = await desk.newPage();
    await p.goto(url);
    const { form, workUrl } = await showMyWork(p);
    const modes = form.getByRole('group', { name: 'How do you want to show it?' }).getByRole('button');
    // Off by default (D-014 pattern): no video choices.
    await expect(form.getByRole('button', { name: 'Record a video' })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Add a video' })).toHaveCount(0);

    // The administrator turns it on in Admin → Modules → Photos and media.
    await withAdmin(browser, async (admin) => {
      await admin.goto('/admin/modules');
      await admin.getByRole('tab', { name: 'Photos and media' }).click();
      const toggle = admin.getByRole('switch', { name: /Video evidence/u });
      await expect(toggle).not.toBeChecked();
      await expect(admin.getByText(/Videos usually show children’s faces/u)).toBeVisible();
      await toggle.click({ force: true });
      await expect(toggle).toBeChecked();
    });
    await p.reload();
    await expect(modes.filter({ hasText: 'Record a video' })).toHaveCount(1);
    await expect(modes.filter({ hasText: 'Add a video' })).toHaveCount(1);
    const list = p.getByTestId('student-evidence');

    // "Add a video": a synthetic WebM made in the page.
    const clip = await syntheticVideo(p);
    expect(clip.length).toBeGreaterThan(1000);
    await chooseKind(form, 'Add a video');
    // The real limit for this student (UPLOAD_VIDEO_MAX_MB, 90 by default, or less space left).
    await expect(form.getByText(/up to 3 minutes long and up to \d+ MB/u)).toBeVisible();
    await form.getByLabel('Choose a video').setInputFiles({ name: 'colours.webm', mimeType: 'video/webm', buffer: clip });
    await expect(form.getByTestId('evidence-pending')).toContainText('colours.webm');
    await form.getByLabel('A few words (you can skip this)').fill('My colour video');
    await form.getByRole('button', { name: 'Save my work' }).click();
    const fromFile = list.locator('[data-kind="video"]').filter({ hasText: 'My colour video' });
    await expect(fromFile).toBeVisible();
    await expect(fromFile.locator('video')).toHaveAttribute('preload', 'metadata');

    // "Record a video" with the fake camera: preview, timer to 3:00, Stop, watch, Use this video.
    await p.goto(workUrl);
    await chooseKind(form, 'Record a video');
    const recorder = form.getByTestId('video-recorder');
    const start = recorder.getByRole('button', { name: 'Start recording' });
    await expect(start).toBeEnabled();
    expect(await seriousViolations(p, '[data-testid="evidence-form"]')).toEqual([]);
    await start.click();
    await expect(recorder.getByTestId('video-timer')).toContainText('of 3:00');
    await p.waitForTimeout(1500);
    await recorder.getByRole('button', { name: 'Stop' }).click();
    const preview = recorder.getByLabel('The video you recorded');
    await expect(preview).toBeVisible();
    // The clip itself loads in the player (a camera stream left on the element would win over src).
    await expect
      .poll(() => preview.evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc.startsWith('blob:'), stream: v.srcObject !== null, ready: v.readyState >= 1 })))
      .toEqual({ src: true, stream: false, ready: true });
    await recorder.getByRole('button', { name: 'Use this video' }).click();
    await expect(form.getByTestId('evidence-pending')).toContainText('video.webm');
    await form.getByLabel('A few words (you can skip this)').fill('Me saying hello');
    await form.getByRole('button', { name: 'Save my work' }).click();
    await expect(list.locator('[data-kind="video"]').filter({ hasText: 'Me saying hello' })).toBeVisible();
    expect(await seriousViolations(p, '[data-testid="student-evidence"]')).toEqual([]);

    const detail = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`)).body as { evidence: Array<{ id: string; body: string | null; file: { id: string; mime: string } | null }> };
    const videos = detail.evidence.filter((e) => e.file?.mime === 'video/webm');
    expect(videos.map((e) => e.body).sort()).toEqual(['Me saying hello', 'My colour video']);
    added.push(...videos.map((e) => e.id));

    // The teacher plays the student's video on the Goals page (Range requests, 206).
    const ranged = page.waitForResponse((r) => r.url().includes(`/api/files/${videos.find((e) => e.body === 'My colour video')!.file!.id}`) && r.status() === 206);
    await page.goto(`/teacher/goals?contextId=${ctx.id}&studentId=${student.id}`);
    const view = page.getByTestId('teacher-student-goals');
    const item = view.locator('li.cc-evidence[data-kind="video"]').filter({ hasText: 'My colour video' });
    await expect(item).toBeVisible();
    const video = item.locator('video');
    await expect(video).toHaveAttribute('controls', '');
    const played = await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 600));
      return { time: v.currentTime, error: v.error?.code ?? null, width: v.videoWidth };
    });
    expect(played.error).toBeNull();
    expect(played.time).toBeGreaterThan(0);
    expect(played.width).toBe(160);
    expect((await ranged).headers()['content-type']).toBe('video/webm');
    expect(await seriousViolations(page, '[data-testid="teacher-student-goals"]')).toEqual([]);
  } finally {
    const p = desk.pages()[0];
    if (p) for (const id of added) await api(p, 'DELETE', `/api/student/evidence/${id}`);
    await desk.close();
    await videoSwitch(browser, false);
  }
});

test('on a phone "Record a video" is the in-page recorder with the camera app as a second choice, and the form passes axe @mobile', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'mobile', 'phone layout');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page);
  const student = ((await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Rostered[])[14]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  try {
    await videoSwitch(browser, true);
    const p = await phone.newPage();
    await p.goto(url);
    const { form, workUrl } = await showMyWork(p);
    await chooseKind(form, 'Record a video');
    await expect(form.getByTestId('video-recorder')).toHaveCount(1);
    const input = form.getByLabel('Use the camera app instead');
    await expect(input).toHaveAttribute('capture', 'environment');
    await expect(input).toHaveAttribute('accept', 'video/*');
    await expect(form.getByText('The camera app makes big files: keep your video under 1 minute.')).toBeVisible();
    expect(await seriousViolations(p, '[data-testid="evidence-form"]')).toEqual([]);
    await p.goto(workUrl);
    await chooseKind(form, 'Add a video');
    expect(await seriousViolations(p, '[data-testid="evidence-form"]')).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  } finally {
    await phone.close();
    await videoSwitch(browser, false);
  }
});
