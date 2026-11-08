/**
 * Starts the REAL server for Playwright on a temporary data directory with the fictional demo school.
 * Test-only: NODE_ENV=test, a fixed test pepper, fixed demo passwords (CC_DEMO_PASSWORD, which
 * the seed refuses outside NODE_ENV=test) and a file mail transport (CC_TEST_MAIL_DIR, no SMTP). The temp directory is removed on exit.
 *   node e2e/server.ts            (PORT and E2E_PASSWORD come from playwright.config.ts)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3299';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-'));
// Email goes to JSON files here instead of SMTP (test-only, config.ts); e2e/mail.ts reads them.
const mailDir = path.join(os.tmpdir(), `cc-e2e-mail-${port}`);
// Test clock (S12): milliseconds added to the server clock, read from this file (NODE_ENV=test only).
const clockFile = process.env.CC_TEST_CLOCK_FILE ?? path.join(os.tmpdir(), `cc-e2e-clock-${port}`);
fs.writeFileSync(clockFile, '0');
fs.rmSync(mailDir, { recursive: true, force: true });

Object.assign(process.env, {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: port,
  DATA_DIR: dataDir,
  SECRET_PEPPER: 'e2e-test-pepper-not-a-secret-0123456789',
  PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  TRUST_PROXY: 'false',
  SMTP_HOST: '',
  CC_DEMO_PASSWORD: process.env.E2E_PASSWORD ?? 'e2e-only-Passw0rd!',
  // The suite signs in many times; the override is honoured only under NODE_ENV=test (config.ts).
  CC_TEST_LOGIN_RATE_LIMIT: '1000',
  CC_TEST_MAIL_DIR: mailDir,
  // No network in tests: the weather service is unreachable, so the widget stays hidden (D-106).
  WEATHER_API_URL: 'http://127.0.0.1:9/v1/forecast',
  // Super Speakers (S12): the e2e week rollover moves this clock; a short board heartbeat notices it fast.
  CC_TEST_CLOCK_FILE: clockFile,
  SPEAKERS_HEARTBEAT_MS: '1000',
});

const cleanup = () => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(mailDir, { recursive: true, force: true });
    fs.rmSync(clockFile, { force: true });
  } catch {
    /* best effort */
  }
};
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));

const seed = spawnSync(process.execPath, [path.join(root, 'src/server/cli.ts'), 'seed:demo'], { env: process.env, encoding: 'utf8' });
if (seed.status !== 0) {
  console.error(seed.stdout, seed.stderr);
  process.exit(1);
}
console.log(`[e2e] demo school seeded in ${dataDir}`);
await import('../src/server/main.ts');
