/** Reads the e2e server's fake mailbox (CC_TEST_MAIL_DIR, see e2e/server.ts). Fictional data only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';

export interface TestMail {
  to: string;
  subject: string;
  text: string;
}

const mailDir = () => path.join(os.tmpdir(), `cc-e2e-mail-${process.env.E2E_PORT}`);

export function mailsTo(address: string): TestMail[] {
  const dir = mailDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as TestMail)
    .filter((m) => m.to === address);
}

/** Waits for the n-th email to an address (1-based) and returns it. */
export async function waitForMail(address: string, n: number): Promise<TestMail> {
  await expect.poll(() => mailsTo(address).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(n);
  return mailsTo(address)[n - 1]!;
}

export const linkIn = (text: string) => /https?:\/\/\S+#token=[A-Za-z0-9_-]+/u.exec(text)![0];
export const codeIn = (text: string) => /\n(\d{6})\n/u.exec(text)![1]!;
