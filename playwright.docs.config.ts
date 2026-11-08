/**
 * Screenshots for the user guides (docs/guides/img/{en,tr}). NOT part of the normal e2e suite
 * (playwright.config.ts ignores the spec). Run it on purpose, after a UI change:
 *
 *   npx playwright test -c playwright.docs.config.ts      (or: npm run docs:screenshots)
 *
 * It builds the client, starts a throw-away server with the fictional demo school plus
 * `seed:demo-history` (E2E_DEMO_HISTORY=1, e2e/server.ts), and writes compressed PNGs into
 * docs/guides/img/en and docs/guides/img/tr. Fictional data only.
 */
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

const port = Number(process.env.E2E_PORT);

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /docs-screenshots\.spec\.ts/,
  timeout: 600_000,
  reporter: 'list',
  use: { ...base.use, trace: 'off', screenshot: 'off', actionTimeout: 15_000 },
  projects: [
    {
      name: 'docs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, hasTouch: true },
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
