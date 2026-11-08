/**
 * Usability screenshot crawler (e2e/usability-screens.spec.ts). NOT part of the normal e2e suite
 * (playwright.config.ts ignores the spec). Run it on purpose, before and after a UI change:
 *
 *   npm run usability:screens                       (label "before")
 *   USABILITY_LABEL=after npm run usability:screens  (PowerShell: $env:USABILITY_LABEL='after'; npm run usability:screens)
 *   USABILITY_KEEP=1 npm run usability:screens -- -g classroom   (re-shoot one area into the existing set)
 *
 * It builds the client, starts a throw-away server with the fictional demo school plus
 * `seed:demo-history` (E2E_DEMO_HISTORY=1, e2e/server.ts) and writes full-page PNGs to
 * usability-shots/<label>/ (git-ignored, never committed). Fictional data only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

const port = Number(process.env.E2E_PORT);
const label = (process.env.USABILITY_LABEL ?? 'before').replace(/[^A-Za-z0-9_-]/gu, '-');
process.env.USABILITY_LABEL = label;

// Start every run with an empty folder. The config is evaluated in the runner and in every worker;
// only the runner (no TEST_WORKER_INDEX) clears it, so a restarted worker never wipes earlier shots.
// USABILITY_KEEP=1 keeps the folder (to re-run one area with -g into an existing set).
if (!process.env.TEST_WORKER_INDEX && process.env.USABILITY_KEEP !== '1') {
  const out = path.resolve(import.meta.dirname, 'usability-shots', label);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
}

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /usability-screens\.spec\.ts/,
  // One area per test; the classroom area alone runs the full lesson flow seven times.
  timeout: 3 * 60 * 60_000,
  retries: 0,
  reporter: 'list',
  use: { ...base.use, trace: 'off', screenshot: 'off', actionTimeout: 15_000 },
  projects: [
    {
      name: 'usability',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, hasTouch: true, launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
    },
  ],
  webServer: {
    command: 'node --run build && node e2e/server.ts',
    url: `http://127.0.0.1:${port}/healthz`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { PORT: String(port), E2E_PASSWORD: process.env.E2E_PASSWORD ?? '', E2E_DEMO_HISTORY: '1' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
