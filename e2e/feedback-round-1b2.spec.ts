/**
 * S13b2 in the browser (fictional demo data only):
 * - Link cards (D-120): 30 students print on exactly 2 A4 pages; the printed QR (with its quiet zone)
 *   decodes with jsQR back to the student's link; the links page passes axe.
 * - Emergency replace (D-118) from the links page: the old link stops working, the new one opens.
 * - Student-page language (D-117): Turkish-only student pages for an English-only class.
 * - Evidence (D-119): with the media flags off only Write / Add a link / Add a document; with them on,
 *   a picture from a file, a picture taken with the (fake) camera, a document, a voice recording with
 *   the (fake) microphone and a voice file; axe on the evidence area at 375×812.
 * - The admin archives a default goal for the whole school and restores it (D-116).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import jsQRImport from 'jsqr';
import sharp from 'sharp';
import { en } from '../src/shared/i18n/en.ts';
import { tr } from '../src/shared/i18n/tr.ts';
import { api, ensurePin, login, PASSWORD, studentLinkUrl } from './helpers.ts';

// jsqr is a CommonJS bundle: its default export is the decoder at runtime, typed as a namespace under NodeNext.
type Decode = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;
const jsQR = ((jsQRImport as unknown as { default?: Decode }).default ?? jsQRImport) as unknown as Decode;

type Ctx = {
  id: string;
  classId: string;
  className: string;
  subjectName: { en: string };
};
type Rostered = { id: string; fullName: string };

async function englishContext(page: Page, className: string): Promise<Ctx> {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[];
  return mine.find((c) => c.className === className && c.subjectName.en === 'English')!;
}
async function rosterOf(page: Page, contextId: string): Promise<Rostered[]> {
  return (await api(page, 'GET', `/api/classroom/contexts/${contextId}/roster`)).body.students as Rostered[];
}
async function seriousViolations(page: Page, include?: string) {
  // Let short entrance animations (a toast fading in) finish, so axe measures the final colours.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const r = await builder.analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
}

/** Admin session in its own context, for the media flags. */
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
const MEDIA = ['media.evidencePhotos', 'media.evidenceAudio'] as const;
async function setMedia(browser: Browser, on: boolean) {
  await withAdmin(browser, async (admin) => {
    for (const m of MEDIA)
      expect(
        (
          await api(admin, 'PUT', `/api/admin/module-policies/${m}`, {
            availability: on ? 'enabled' : 'disabled',
          })
        ).status,
      ).toBe(200);
  });
}

/**
 * Fixed UI strings of one language that appear as a whole line of the page. Only strings that differ
 * from the other language and never occur in it are counted, so names and data do not interfere.
 */
const otherValues = { en: new Set<string>(Object.values(tr)), tr: new Set<string>(Object.values(en)) };
async function uiStringsOn(page: Page, lang: 'en' | 'tr'): Promise<string[]> {
  const dict: Record<string, string> = lang === 'en' ? en : tr;
  const other: Record<string, string> = lang === 'en' ? tr : en;
  const lines = new Set((await page.locator('body').innerText()).split('\n').map((l) => l.trim()));
  return Object.keys(dict)
    .filter((k) => dict[k] !== other[k] && !dict[k]!.includes('{') && dict[k]!.length >= 6 && !otherValues[lang].has(dict[k]!))
    .map((k) => dict[k]!)
    .filter((v) => lines.has(v));
}

/** A short silent WAV (fictional recording). */
function silentWav(ms = 600, rate = 8000): Buffer {
  const samples = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(samples * 2, 40);
  return b;
}

test('30 link cards print on 2 A4 pages and the printed QR decodes to the link; the links page passes axe', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'print layout is checked once, on the desktop project');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page, '4-C');
  // Show exactly 30 students of 4-C (34 in the demo school) by trimming the list response.
  await page.route('**/api/teacher/classes/*/student-links', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { students: unknown[] };
    await route.fulfill({
      response: res,
      json: { ...body, students: body.students.slice(0, 30) },
    });
  });
  await page.goto('/teacher/student-links');
  const links = page.getByTestId('links-page');
  await links.getByLabel('Class', { exact: true }).selectOption({ label: ctx.className });
  await expect(links.getByTestId('link-row')).toHaveCount(30);
  await expect(links.getByRole('button', { name: 'Print all 30 cards' })).toBeEnabled();
  expect(await seriousViolations(page)).toEqual([]);

  // The print copy: 2 pages of 15 small cards.
  await expect(page.getByTestId('link-sheets-print').getByTestId('link-page')).toHaveCount(2);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/gu) ?? [];
  expect(pages).toHaveLength(2);

  // Rasterise the first printed QR at its printed CSS size (96 dpi, lower than any printer) and decode it.
  await page.emulateMedia({ media: 'print' });
  const firstUrl = await studentLinkUrl(page, ctx.classId, (await page.getByTestId('link-sheets-print').getByTestId('link-card').first().getAttribute('data-student'))!);
  const raster = await page.evaluate(async () => {
    const svg = document.querySelector('.cc-link-sheets--print .cc-qr') as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelector('rect')!.setAttribute('fill', getComputedStyle(svg.querySelector('rect')!).fill);
    clone.querySelector('path')!.setAttribute('fill', getComputedStyle(svg.querySelector('path')!).fill);
    const w = Math.round(rect.width);
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(w));
    clone.removeAttribute('style');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = w;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, w, w);
    return {
      w,
      modules: Number(svg.dataset.modules),
      data: Array.from(g.getImageData(0, 0, w, w).data),
    };
  });
  await page.emulateMedia({ media: 'screen' });
  // The symbol is at least 28 mm wide (≈ 106 CSS px) without the 4-module quiet zone on each side.
  expect((raster.w * raster.modules) / (raster.modules + 8)).toBeGreaterThanOrEqual(104);
  expect(jsQR(Uint8ClampedArray.from(raster.data), raster.w, raster.w)?.data).toBe(firstUrl);
});

test('an emergency replace from the links page stops the old link and the new one opens', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'checked once, on the desktop project');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page, '3-B');
  const student = (await rosterOf(page, ctx.id))[2]!;
  const oldUrl = await studentLinkUrl(page, ctx.classId, student.id);

  await page.goto('/teacher/student-links');
  const links = page.getByTestId('links-page');
  await links.getByLabel('Class', { exact: true }).selectOption({ label: ctx.className });
  const row = links.getByTestId('link-row').filter({ hasText: student.fullName });
  await row.getByRole('button', { name: 'Emergency' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  expect(await seriousViolations(page, '[role="alertdialog"]')).toEqual([]);
  const confirm = dialog.getByRole('button', { name: 'Make new link' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Card lost on the school bus (test)');
  await dialog.getByLabel(`To confirm, type: ${student.fullName}`).fill(student.fullName.toLocaleUpperCase('tr-TR'));
  await confirm.click();
  await expect(page.getByText(`A new link was made for ${student.fullName}`)).toBeVisible();
  await expect(row.getByText(/A new link was made on/u)).toBeVisible();
  const newUrl = await studentLinkUrl(page, ctx.classId, student.id);
  expect(newUrl).not.toBe(oldUrl);

  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'en-GB',
  });
  try {
    const p = await phone.newPage();
    await p.goto(oldUrl);
    await expect(p.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
    // A fresh page: a hash-only change on the same page is not a new load.
    const q = await phone.newPage();
    await q.goto(newUrl);
    await expect(q.getByRole('heading', { name: `Hello, ${student.fullName}!` })).toBeVisible();
  } finally {
    await phone.close();
  }
});

test('admin link dialog for a deactivated student: says the link does not work, no copy or print, emergency revoke only', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'checked once, on the desktop project');
  test.setTimeout(120_000);
  await login(page, 'english');
  const ctx = await englishContext(page, '3-B');
  await withAdmin(browser, async (admin) => {
    const name = 'Defne Kurgusal Örnek';
    const added = await api(admin, 'POST', '/api/admin/students', { classId: ctx.classId, fullName: name, allowDuplicateName: true });
    expect(added.status).toBe(200);
    const id = added.body.id as string;
    expect((await api(admin, 'POST', `/api/admin/students/${id}/deactivate`, {})).status).toBe(200);
    await admin.goto('/admin/students');
    await admin.getByLabel('Search by name or number').fill(name);
    await admin.getByText('Include deactivated students').click();
    const row = admin.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = admin.getByRole('dialog');
    await expect(dialog.getByText('This student is deactivated, so the link does not work.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Print card' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Emergency' }).click();
    const alert = admin.getByRole('alertdialog');
    await expect(alert.getByRole('button', { name: 'Revoke link' })).toBeVisible();
    await expect(alert.getByRole('option', { name: 'Make a new link' })).toHaveCount(0);
    await alert.getByLabel('Reason').fill('Card seen by a visitor (test)');
    await alert.getByLabel(`To confirm, type: ${name}`).fill(name);
    await alert.getByRole('button', { name: 'Revoke link' }).click();
    await expect(admin.getByText(`${name}’s link was revoked`)).toBeVisible();
  });
});

test('Turkish-only student pages for an English-only class @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page, '3-B');
  const student = (await rosterOf(page, ctx.id))[test.info().project.name === 'mobile' ? 5 : 4]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  const setLanguage = async (
    studentPage: {
      mainLanguage: 'en' | 'tr';
      secondLanguageEnabled: boolean;
    } | null,
  ) =>
    expect(
      (
        await api(page, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, {
          mainLanguage: 'en',
          secondLanguageEnabled: false,
          studentPage,
        })
      ).status,
    ).toBe(200);
  await setLanguage({ mainLanguage: 'tr', secondLanguageEnabled: false });
  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    locale: 'en-GB',
  });
  try {
    const p = await phone.newPage();
    await p.goto(url);
    await expect(p.getByRole('heading', { name: `Merhaba, ${student.fullName}!` })).toBeVisible();
    await expect(p.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(p.getByRole('button', { name: 'English' })).toHaveCount(0);
    // Turkish UI strings are there; no English UI string is.
    await expect.poll(async () => (await uiStringsOn(p, 'tr')).length).toBeGreaterThan(3);
    expect(await uiStringsOn(p, 'en')).toEqual([]);
    // The cards of this class carry the Turkish short line.
    expect((await api(page, 'GET', `/api/teacher/classes/${ctx.classId}/student-links`)).body.cardLanguage).toBe('tr');
    // The classroom display of the same class stays English only (its own session: classroom mode
    // puts that session behind the PIN, and this page still has to restore the language).
    const room = await browser.newContext({ locale: 'en-GB' });
    try {
      const d = await room.newPage();
      await login(d, 'english');
      await d.goto('/classroom');
      await d.getByRole('button', { name: `${ctx.className} · English` }).first().click();
      await expect(d.locator('html')).toHaveAttribute('lang', 'en');
      await expect.poll(async () => (await uiStringsOn(d, 'en')).length).toBeGreaterThan(3);
      expect(await uiStringsOn(d, 'tr')).toEqual([]);
    } finally {
      await room.close();
    }
  } finally {
    await phone.close();
    await setLanguage(null);
  }
});

test('evidence: only text, link and document while the media flags are off; pictures, camera, documents, voice and voice files when on', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'the in-page camera needs a fine pointer; the phone variant runs below');
  test.setTimeout(180_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page, '3-B');
  const student = (await rosterOf(page, ctx.id))[6]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  const desk = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
    locale: 'en-GB',
    permissions: ['camera', 'microphone'],
  });
  try {
    const p = await desk.newPage();
    await p.goto(url);
    const english = p.getByRole('region', { name: 'English', exact: true });
    const form = english.getByTestId('evidence-form');
    const modes = form.getByRole('group', { name: 'What kind of evidence?' }).getByRole('button');
    await expect(modes).toHaveText(['Write', 'Add a link', 'Add a document']);

    await setMedia(browser, true);
    await p.reload();
    await expect(modes).toHaveText(['Write', 'Add a link', 'Add a picture', 'Take a picture', 'Add a document', 'Record my voice', 'Add a voice file']);
    const list = english.getByRole('region', { name: 'My evidence' });

    // Two pictures from files at once: each becomes its own evidence item with the caption.
    await form.getByRole('button', { name: 'Add a picture' }).click();
    const png = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 3,
        background: { r: 40, g: 90, b: 200 },
      },
    })
      .png()
      .toBuffer();
    await form.getByLabel('Choose pictures').setInputFiles([
      { name: 'poster-one.png', mimeType: 'image/png', buffer: png },
      { name: 'poster-two.png', mimeType: 'image/png', buffer: png },
    ]);
    await expect(form.getByTestId('evidence-pending').getByRole('listitem')).toHaveCount(2);
    await form.getByLabel('A few words about it (optional)').fill('My two posters');
    await form.getByRole('button', { name: 'Add 2 items' }).click();
    await expect(list.locator('[data-kind="picture"]').filter({ hasText: 'My two posters' })).toHaveCount(2);
    // Tap a picture to see it large.
    await list
      .locator('[data-kind="picture"]')
      .first()
      .getByRole('button', { name: /See the picture large/u })
      .click();
    await expect(p.getByRole('dialog').getByRole('img')).toBeVisible();
    await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // A HEIC picture gets a friendly explanation instead of an upload.
    await form.getByLabel('Choose pictures').setInputFiles({
      name: 'IMG_0001.HEIC',
      mimeType: 'image/heic',
      buffer: Buffer.from('not really heic'),
    });
    await expect(form.getByText(/HEIC pictures cannot be used here/u)).toBeVisible();

    // Take a picture with the (fake) camera: shutter, retake, use photo.
    await form.getByRole('button', { name: 'Take a picture' }).click();
    const shutter = form.getByRole('button', { name: 'Take the picture' });
    await expect(shutter).toBeEnabled();
    await shutter.click();
    await form.getByRole('button', { name: 'Take it again' }).click();
    await form.getByRole('button', { name: 'Take the picture' }).click();
    await form.getByRole('button', { name: 'Use this picture' }).click();
    await expect(form.getByTestId('evidence-pending').getByRole('listitem')).toHaveCount(1);
    await form.getByLabel('A few words about it (optional)').fill('Taken in class');
    await form.getByRole('button', { name: 'Add evidence' }).click();
    await expect(list.locator('[data-kind="picture"]').filter({ hasText: 'Taken in class' })).toHaveCount(1);

    // A document.
    await form.getByRole('button', { name: 'Add a document' }).click();
    await form.getByLabel('Choose documents').setInputFiles({
      name: 'book-review.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('A fictional book review.\n'),
    });
    await form.getByRole('button', { name: 'Add evidence' }).click();
    await expect(list.locator('[data-kind="file"]').filter({ hasText: 'book-review.txt' })).toBeVisible();

    // Record my voice with the (fake) microphone: timer, stop, playback, add.
    await form.getByRole('button', { name: 'Record my voice' }).click();
    await form.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(form.getByTestId('voice-timer')).toContainText('of 5:00');
    await p.waitForTimeout(1200);
    await form.getByRole('button', { name: 'Stop' }).click();
    await expect(form.getByLabel('Your recording')).toBeVisible();
    await form.getByLabel('A few words about it (optional)').fill('Me reading aloud');
    await form.getByRole('button', { name: 'Add evidence' }).click();
    await expect(list.locator('[data-kind="audio"]').filter({ hasText: 'Me reading aloud' })).toBeVisible();

    // A voice file.
    await form.getByRole('button', { name: 'Add a voice file' }).click();
    await form.getByLabel('Choose a voice file').setInputFiles({
      name: 'song.wav',
      mimeType: 'audio/wav',
      buffer: silentWav(),
    });
    await form.getByLabel('A few words about it (optional)').fill('Our class song');
    await form.getByRole('button', { name: 'Add evidence' }).click();
    await expect(list.locator('[data-kind="audio"]').filter({ hasText: 'Our class song' })).toBeVisible();
    // The goals area with every kind of evidence (success toasts still fading in are not part of it).
    expect(await seriousViolations(p, '[data-testid="student-goals"]')).toEqual([]);

    // The teacher sees every item; the server downscaled the pictures to 2048 px.
    const detail = (await api(page, 'GET', `/api/teacher/contexts/${ctx.id}/students/${student.id}/goals`)).body as {
      evidence: Array<{
        kind: string;
        file: { id: string; mime: string } | null;
      }>;
    };
    expect(detail.evidence.filter((e) => e.file?.mime === 'image/jpeg')).toHaveLength(3);
    expect(detail.evidence.filter((e) => e.kind === 'audio')).toHaveLength(2);
    const picture = detail.evidence.find((e) => e.file?.mime === 'image/jpeg')!;
    const bytes = await page.request.get(`/api/files/${picture.file!.id}`);
    const meta = await sharp(await bytes.body()).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2048);
  } finally {
    await desk.close();
    await setMedia(browser, false);
  }
});

test('the evidence area on a phone passes axe with every choice on, and the teacher adds evidence too @mobile', async ({ page, browser }) => {
  test.skip(test.info().project.name !== 'mobile', 'phone layout');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await englishContext(page, '3-B');
  const student = (await rosterOf(page, ctx.id))[7]!;
  const url = await studentLinkUrl(page, ctx.classId, student.id);
  await setMedia(browser, true);
  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    locale: 'en-GB',
  });
  try {
    const p = await phone.newPage();
    await p.goto(url);
    const english = p.getByRole('region', { name: 'English', exact: true });
    const form = english.getByTestId('evidence-form');
    await expect(form.getByRole('group', { name: 'What kind of evidence?' }).getByRole('button')).toHaveCount(7);
    // On a phone "Take a picture" opens the system camera through a capture input.
    await form.getByRole('button', { name: 'Take a picture' }).click();
    await expect(form.getByLabel('Open the camera')).toHaveAttribute('capture', 'environment');
    await form.getByRole('button', { name: 'Record my voice' }).click();
    await expect(form.getByText('You can record for up to 5 minutes.')).toBeVisible();
    expect(await seriousViolations(p, '[data-testid="evidence-form"]')).toEqual([]);
    const width = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);

    // The teacher adds a link as evidence; the student sees it marked "Teacher".
    expect(
      (
        await api(page, 'POST', `/api/teacher/contexts/${ctx.id}/students/${student.id}/evidence`, {
          kind: 'link',
          url: 'https://example.org/fictional-reading-list',
          body: 'Reading list from class',
        })
      ).status,
    ).toBe(200);
    await p.reload();
    const item = english.getByRole('region', { name: 'My evidence' }).getByRole('listitem').filter({ hasText: 'Reading list from class' });
    await expect(item.getByText('Teacher', { exact: true })).toBeVisible();
    await expect(item.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  } finally {
    await phone.close();
    await setMedia(browser, false);
  }
});

test('teacher library: archive a default goal for my classes; the admin archives one for the whole school', async ({ page, browser }) => {
  test.skip(test.info().project.name === 'mobile', 'checked once, on the desktop project');
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await page.goto('/teacher/goals');
  await page.getByRole('tab', { name: 'Categories and preset goals' }).click();
  const lib = page.getByTestId('goals-library');
  const preset = lib.getByTestId('library-preset').filter({ hasText: 'I will read a short book every week.' });
  await preset.getByRole('button', { name: /^Archive:/u }).click();
  await expect(preset).toHaveCount(0);
  await lib.getByText(/^Show archived/u).click();
  await expect(preset.getByText('Archived', { exact: true })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await preset.getByRole('button', { name: /^Restore:/u }).click();
  await expect(preset.getByText('Archived', { exact: true })).toHaveCount(0);

  await withAdmin(browser, async (admin) => {
    try {
      await admin.goto('/admin/modules');
      const section = admin.getByTestId('admin-goal-defaults');
      const row = section.getByRole('listitem').filter({ hasText: /^I will read a short book every week\./u });
      await row.getByRole('button', { name: /^Archive:/u }).click();
      await expect(row.getByText('Archived by the school')).toBeVisible();
      expect(await seriousViolations(admin, '[data-testid="admin-goal-defaults"]')).toEqual([]);
      await page.reload();
      await page.getByRole('tab', { name: 'Categories and preset goals' }).click();
      await page
        .getByTestId('goals-library')
        .getByText(/^Show archived/u)
        .click();
      const teacherRow = page.getByTestId('library-preset').filter({ hasText: 'I will read a short book every week.' });
      await expect(teacherRow.getByText('Archived by the school')).toBeVisible();
      await expect(teacherRow.getByRole('button', { name: /^Restore:/u })).toHaveCount(0);
      await row.getByRole('button', { name: /^Restore:/u }).click();
      await expect(row.getByText('Archived by the school')).toHaveCount(0);
    } finally {
      // Never leave the school default archived for the other specs.
      const d = (await api(admin, 'GET', '/api/admin/goal-defaults')).body as {
        presets: Array<{
          id: string;
          text: { en?: string };
          archived: boolean;
        }>;
      };
      for (const pr of d.presets.filter((x) => x.archived && x.text.en === 'I will read a short book every week.'))
        await api(admin, 'PUT', `/api/admin/goal-defaults/preset/${pr.id}`, {
          archived: false,
        });
    }
  });
});
