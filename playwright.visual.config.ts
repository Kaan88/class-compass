/**
 * Visual regression baseline (S26a, D-189). NOT part of the normal e2e suite (playwright.config.ts
 * ignores the spec). It compares about twenty stable screens with committed pictures:
 *
 *   npm run test:visual            compare with the baselines (fails on a difference; see the report)
 *   npm run test:visual:update     take new baselines after an intended change, then review the diff
 *
 * Same throw-away server as the e2e suite (e2e/server.ts, fictional demo school), started at a fixed
 * moment (E2E_FIXED_NOW, also the browser's clock) with fixed demo ids (CC_TEST_ID_SEED, so the
 * generated avatars are the same every run); both work only under NODE_ENV=test. Reduced motion,
 * animations stopped, fonts loaded, and anything that still changes from run to run masked.
 *
 * Baselines depend on the operating system's font rendering, so they live per platform:
 * e2e/visual-baselines/<platform>/<project>/<name>.png. Only win32 (the development machine) is
 * committed; Linux CI needs its own set taken on Linux when CI is switched back on (docs/OPERATIONS.md).
 */
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

/** Wednesday 11 November 2026, 10:30 in Istanbul: a school day in the demo school year. */
process.env.E2E_FIXED_NOW ??= '2026-11-11T07:30:00.000Z';
const port = Number(process.env.E2E_PORT);

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /visual\.spec\.ts/,
  timeout: 120_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]],
  outputDir: 'test-results/visual',
  snapshotPathTemplate: '{testDir}/visual-baselines/{platform}/{projectName}/{arg}{ext}',
  // A missing baseline is a failure, never written on the fly (npm run test:visual:update writes them).
  updateSnapshots: 'none',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // A pixel counts as changed when its colour moved by more than 3 % (YIQ distance; Playwright's
      // default of 20 % lets a whole button turn a few shades greener unnoticed). Layered scenes can
      // move a few dozen edge pixels between runs (under 0.01 %); a changed colour token or a moved box
      // changes far more than 0.1 % of the picture (D-189: proven with a one-token change).
      maxDiffPixelRatio: 0.001,
      threshold: 0.03,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      stylePath: './e2e/visual.css',
    },
  },
  use: { ...base.use, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'off', actionTimeout: 15_000 },
  projects: [
    {
      // The real classroom display (D-174 sample): 1536×703 CSS px at pixel ratio 1.25, touch.
      name: 'display',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 703 }, deviceScaleFactor: 1.25, hasTouch: true },
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: 'node --run build && node e2e/server.ts',
    url: `http://127.0.0.1:${port}/healthz`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { PORT: String(port), E2E_PASSWORD: process.env.E2E_PASSWORD ?? '', E2E_DEMO_HISTORY: '', E2E_FIXED_NOW: process.env.E2E_FIXED_NOW, CC_TEST_ID_SEED: '20261111' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
