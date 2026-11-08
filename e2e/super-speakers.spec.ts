/**
 * Super Speakers end to end (S12, SSP-1..8): the administrator switches the module on and creates a
 * scorer link and a board link on Admin → Super Speakers; a scorer on a phone (Pixel 7 viewport)
 * opens the link, searches "isik" (finds "Işık"), gives +1 and undoes it; the board on a 1920×1080
 * screen updates live (Server-Sent Events) without a reload, fits without scrolling at 1920×1080 and
 * 1280×720, and shows the placeholder after the weekly reset (server test clock moved past Monday
 * 00:00, NODE_ENV=test only). Fictional demo data only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devices, expect, test, type Page } from '@playwright/test';
import { api, login } from './helpers.ts';

const clockFile = path.join(os.tmpdir(), `cc-e2e-clock-${process.env.E2E_PORT}`);
const setServerClockOffset = (ms: number) => fs.writeFileSync(clockFile, String(ms));

/** Milliseconds from now until a minute after the next Monday 00:00 in Istanbul (UTC+3, no DST). */
function untilNextWeek(): number {
  const now = Date.now();
  const local = new Date(now + 3 * 3600_000);
  const daysToMonday = ((8 - local.getUTCDay()) % 7) || 7;
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysToMonday);
  return mondayLocal - 3 * 3600_000 + 60_000 - now;
}

/** Starts the week clean: every live point of this week is removed by the administrator (audited). */
async function clearThisWeek(page: Page) {
  const awards = (await api(page, 'GET', '/api/admin/speakers/awards?includeVoided=0')).body.awards as Array<{ id: string }>;
  for (const a of awards) expect((await api(page, 'POST', `/api/admin/speakers/awards/${a.id}/void`, { reason: 'e2e clean start' })).status).toBe(200);
}

async function fitsWithoutScrolling(page: Page) {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test('admin creates links; a phone scorer finds "isik", gives +1 and undoes; the board updates live and resets weekly', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  await login(page, 'admin');
  expect((await api(page, 'PUT', '/api/admin/module-policies/superSpeakers', { availability: 'enabled' })).status).toBe(200);
  await clearThisWeek(page);

  // Admin page: create a scorer link and a board link.
  await page.goto('/admin/super-speakers');
  await expect(page.getByTestId('speakers-admin')).toBeVisible();
  await page.getByRole('tab', { name: 'Links' }).click();
  await page.getByTestId('create-scorer').getByLabel('Name shown in the log').fill(`Ms Deniz ${stamp}`);
  await page.getByTestId('create-scorer').getByRole('button', { name: 'Create scorer link' }).click();
  await expect(page.getByTestId('scorer-link-row').filter({ hasText: `Ms Deniz ${stamp}` })).toBeVisible();
  await page.getByTestId('create-board').getByLabel('Where is this screen?').fill(`Hall ${stamp}`);
  await page.getByTestId('create-board').getByRole('button', { name: 'Create board link' }).click();
  await expect(page.getByTestId('board-link-row').filter({ hasText: `Hall ${stamp}` })).toBeVisible();
  const overview = (await api(page, 'GET', '/api/admin/speakers')).body;
  const scorerUrl = overview.scorerLinks.find((l: { label: string }) => l.label === `Ms Deniz ${stamp}`).url as string;
  const boardUrl = overview.displayLinks.find((l: { label: string }) => l.label === `Hall ${stamp}`).url as string;
  expect(scorerUrl).toMatch(/\/p#[A-Za-z0-9_-]{43}$/u);
  expect(boardUrl).toMatch(/\/board#[A-Za-z0-9_-]{43}$/u);
  // A fictional pupil called Işık in 4-C (deactivated again at the end, so other tests' rosters stay as seeded).
  const c4c = overview.classes.find((c: { name: string }) => c.name === '4-C').id as string;
  const isik = await api(page, 'POST', '/api/admin/students', { classId: c4c, fullName: `Işık Konuşkan ${stamp}` });
  expect(isik.status).toBe(200);

  // The board on a 1920×1080 screen (its own browser context, like a separate device).
  const screenCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const board = await screenCtx.newPage();
  await board.goto(boardUrl);
  await expect(board).toHaveURL(/\/board$/u);
  await expect(board.getByTestId('board-placeholder')).toHaveText(/We are waiting for our super speakers/u);
  await expect(board.getByTestId('board-classes')).toContainText('3-A');
  expect(await fitsWithoutScrolling(board)).toBe(true);

  // The scorer on a phone.
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  await phone.goto(scorerUrl);
  await expect(phone).toHaveURL(/\/p$/u);
  await expect(phone.getByTestId('scorer-welcome')).toBeVisible();
  await expect(phone.getByTestId('scorer-install')).toBeVisible();
  await phone.getByTestId('scorer-start').click();
  await phone.getByTestId('scorer-search').fill('isik');
  const first = phone.getByTestId('scorer-results').getByTestId('scorer-student').first();
  await expect(first).toContainText(/Işık/u);
  const name = (await first.locator('.cc-scorer__name').innerText()).trim();
  await first.getByRole('button', { name: `Give ${name} one point` }).click();
  await expect(phone.getByTestId('scorer-undo-bar')).toContainText(`+1 for ${name}`);

  // Live on the board within a few seconds, without a reload.
  await expect(board.getByTestId('board-place-1')).toContainText(name, { timeout: 5_000 });
  await expect(board.getByTestId('board-place-1')).toContainText('1 point');
  expect(await fitsWithoutScrolling(board)).toBe(true);

  // Undo on the phone: the board goes back to the placeholder.
  await phone.getByTestId('scorer-undo').click();
  await expect(board.getByTestId('board-placeholder')).toBeVisible({ timeout: 5_000 });
  await expect(phone.getByTestId('scorer-today')).toContainText('Undone');

  // A real point again (after the double-tap guard), then the board at 1280×720 still fits.
  await phone.waitForTimeout(800);
  await first.getByRole('button', { name: `Give ${name} one point` }).click();
  await expect(board.getByTestId('board-place-1')).toContainText(name, { timeout: 5_000 });
  await expect(phone.getByTestId('scorer-app').locator('.cc-save')).toContainText('Saved', { timeout: 5_000 });
  await board.setViewportSize({ width: 1280, height: 720 });
  expect(await fitsWithoutScrolling(board)).toBe(true);
  await board.setViewportSize({ width: 1920, height: 1080 });

  // Weekly reset: the server clock moves past next Monday 00:00 (Istanbul); the board notices on its own.
  try {
    setServerClockOffset(untilNextWeek());
    await expect(board.getByTestId('board-placeholder')).toBeVisible({ timeout: 10_000 });
    await expect(board.getByTestId('board-classes')).toContainText('3-A');
  } finally {
    setServerClockOffset(0);
  }
  // Back in this week the point is still there (the reset is only a time window).
  await expect(board.getByTestId('board-place-1')).toContainText(name, { timeout: 10_000 });

  await clearThisWeek(page);
  expect((await api(page, 'POST', `/api/admin/students/${isik.body.id}/deactivate`)).status).toBe(200);
  await phoneCtx.close();
  await screenCtx.close();
});
