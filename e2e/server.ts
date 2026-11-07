/**
 * Starts the REAL server for Playwright on a temporary data directory with the fictional demo school.
 * Test-only: NODE_ENV=test, a fixed test pepper, and fixed demo passwords (CC_DEMO_PASSWORD, which
 * the seed refuses outside NODE_ENV=test). The temp directory is removed on exit.
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
});

const cleanup = () => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
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
