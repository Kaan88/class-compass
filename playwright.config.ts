/**
 * End-to-end tests (ENG-3, ENG-4, D-012): builds the client, starts the real server on a free port
 * with a temporary DATA_DIR and the fictional demo school (e2e/server.ts), then runs Chromium as a
 * 1920×1080 touch-enabled classroom display and a mobile viewport. Chromium uses a fake camera and
 * microphone (S13b2 evidence tests), so no real device or permission prompt is involved.
 * Tests share one server/database, so they run serially (workers: 1).
 */
import net from 'node:net';
import { defineConfig, devices } from '@playwright/test';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
    });
  });
}

// The config is evaluated in the runner and in every worker: keep the port and password stable.
process.env.E2E_PORT ??= String(await freePort());
process.env.E2E_PASSWORD ??= 'e2e-only-Passw0rd!';
const port = Number(process.env.E2E_PORT);
const baseURL = `http://127.0.0.1:${port}`;
const launchOptions = { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // The guide screenshots are not a test: they run only with playwright.docs.config.ts.
  testIgnore: /docs-screenshots\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [
    {
      name: 'classroom-display',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, hasTouch: true, launchOptions },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: 'node --run build && node e2e/server.ts',
    url: `${baseURL}/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { PORT: String(port), E2E_PASSWORD: process.env.E2E_PASSWORD, E2E_DEMO_HISTORY: process.env.E2E_DEMO_HISTORY ?? '' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
