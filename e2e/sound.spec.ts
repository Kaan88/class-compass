/**
 * Sound on the classroom display (S14a, D-145): before any tap the browser keeps WebAudio locked, so
 * the top bar says "Sound is off · Turn sound on"; tapping it unlocks audio and the chip goes away.
 * The Display popover's Sound check shows the status and the last sound, and "Test sound" updates it.
 * A second visit with this device's sounds switched off shows the chip again and the tap turns them
 * back on. Fictional demo data only.
 */
import { expect, test } from '@playwright/test';
import { ensurePin, login } from './helpers.ts';

test('the "Sound is off" chip unlocks audio; Test sound updates the Sound check', async ({ page }) => {
  await login(page, 'english');
  await ensurePin(page);
  // A fresh document: no gesture yet, so the browser has not allowed audio.
  await page.goto('/classroom');
  const chip = page.getByTestId('sound-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-status', 'locked');
  await expect(chip).toContainText('Sound is off');
  await expect(chip).toContainText('Turn sound on');
  await chip.click();

  await expect(chip).toHaveCount(0);

  await page.getByTestId('classroom-settings').click();
  const check = page.getByTestId('sound-check');
  await expect(check).toBeVisible();
  await expect(check.getByTestId('sound-status')).toHaveAttribute('data-status', 'running');
  await expect(check.getByTestId('sound-engine')).toHaveText('Running');
  // The chip's tap played the test cue already; Test sound plays it again and the time moves on.
  await expect(check.getByTestId('sound-last')).toContainText('Test sound at');
  const before = await check.getByTestId('sound-last').innerText();
  await page.waitForTimeout(1100);
  await check.getByTestId('sound-test').click();
  await expect(check.getByTestId('sound-last')).not.toHaveText(before);
  await expect(check.getByTestId('sound-last')).toContainText('Test sound at');

  // Sounds off on this device: the status says so and the chip offers to turn them back on.
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('cc.deviceSounds', 'off'));
  await page.reload();
  await expect(chip).toHaveAttribute('data-status', 'mutedDevice');
  await chip.click();
  await expect(chip).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('cc.deviceSounds'))).toBe('on');
});
