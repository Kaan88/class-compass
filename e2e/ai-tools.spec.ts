/**
 * AI tools (S14h1, D-160, D-161): the administrator switches AI tools on and allows student data only
 * with the typed confirmation; a teacher makes a personal token on the Profile behind the classroom
 * PIN lock and with the password again, copies the secret that is shown once, uses it on /mcp and
 * revokes it. Both pages pass axe. Every school setting is switched back in `finally`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login, PASSWORD, PIN } from './helpers.ts';

async function seriousViolations(page: Page) {
  // Dialogs fade in: check the settled page, not a frame of the animation.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const initialize = (page: Page, token: string) =>
  page.request.post('/mcp', {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } }),
  });

test('Admin → AI tools: switch on, student data only with the typed confirmation', async ({ page }) => {
  await login(page, 'admin');
  try {
    await page.goto('/admin/ai-tools');
    await expect(page.getByRole('heading', { name: 'AI tools', level: 1 })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByText('AI tools are on', { exact: true }).click();
    await expect(page.getByText('AI tools settings saved')).toBeVisible();
    await expect.poll(async () => (await api(page, 'GET', '/api/admin/ai-tools')).body.settings.mcpEnabled).toBe(true);

    // Student data: a dialog lists what would leave the school and asks for the typed word.
    await page.getByText('Student data to AI tools', { exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Goals students wrote');
    await expect(dialog).toContainText('KVKK');
    expect(await seriousViolations(page)).toEqual([]);
    const allow = dialog.getByRole('button', { name: 'Allow student data' });
    await expect(allow).toBeDisabled();
    await dialog.getByLabel('To confirm, type: STUDENT DATA').fill('STUDENT DATA');
    await allow.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await api(page, 'GET', '/api/admin/ai-tools')).body.settings.aiStudentDataAllowed).toBe(true);
    await expect(page.getByText(/tokens made with "Names" also send student names/u)).toBeVisible();
    // The audit log names the change.
    await page.goto('/admin/audit');
    await expect(page.getByRole('cell', { name: 'AI tools settings changed' }).first()).toBeVisible();
  } finally {
    expect((await api(page, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false, aiStudentDataAllowed: false })).status).toBe(200);
  }
});

test('Profile → AI tools: PIN lock, password again, secret shown once, revoke', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await login(admin, 'admin');
  try {
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    await login(page, 'english');
    await ensurePin(page);
    // On a classroom device the token endpoints answer 423 until the PIN is entered.
    await page.goto('/classroom');
    await expect(page.getByTestId('classroom-shell')).toBeVisible();
    expect((await api(page, 'POST', '/api/account/ai-tools/tokens', { name: 'Locked', scopes: ['classes:read'], days: 7, currentPassword: PASSWORD })).status).toBe(423);
    await page.goto('/teacher/profile');
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await page.getByLabel('Enter your PIN').fill(PIN);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('teacher-menu')).toBeVisible();
    await page.getByRole('link', { name: 'Profile and PIN' }).first().click();
    const section = page.getByTestId('ai-tools');
    await expect(section.getByRole('heading', { name: 'AI tools', exact: true })).toBeVisible();
    // S19c (D-181): "Connect an AI app" comes first; tokens are under Advanced.
    await expect(section.getByRole('heading', { name: 'Connect an AI app' })).toBeVisible();
    const advanced = section.getByTestId('ai-advanced');
    if (!(await advanced.evaluate((d) => (d as HTMLDetailsElement).open))) await advanced.locator('summary').click();
    await expect(section.getByTestId('ai-url')).toContainText('/mcp');

    await section.getByRole('button', { name: 'New token' }).click();
    const form = page.getByTestId('ai-create-dialog');
    await form.getByLabel('Name', { exact: true }).fill('Claude Code (E2E)');
    await expect(form.getByLabel('See my classes, students and homework')).toBeChecked();
    await expect(form.getByLabel('Set and mark homework')).not.toBeChecked();
    expect(await seriousViolations(page)).toEqual([]);
    // The password is asked again.
    await form.getByLabel('Current password').fill('not-the-password');
    await form.getByRole('button', { name: 'Make token' }).click();
    await expect(form.getByRole('alert')).toContainText('The current password is not correct.');
    await form.getByLabel('Current password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Make token' }).click();

    const shown = page.getByTestId('ai-secret-dialog');
    const secret = (await shown.getByTestId('ai-secret').innerText()).trim();
    expect(secret).toMatch(/^ccmcp_[A-Za-z0-9_-]{43}$/u);
    await expect(shown.getByTestId('ai-command')).toContainText('claude mcp add --transport http');
    expect(await seriousViolations(page)).toEqual([]);
    await shown.getByTestId('ai-copy-token').click();
    await expect(shown.getByTestId('ai-copy-token')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
    await shown.getByRole('button', { name: 'I have stored it' }).click();
    await expect(page.getByTestId('ai-secret')).toHaveCount(0); // shown only once
    await expect(page.getByText(secret)).toHaveCount(0);

    // The token works on /mcp (and only there).
    expect((await initialize(page, secret)).status()).toBe(200);
    const row = section.getByRole('row', { name: /Claude Code \(E2E\)/u });
    await expect(row).toContainText('Active');
    await expect(row).toContainText(secret.slice(0, 10));

    // Revoke: asked in place, then the token stops at once.
    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByTestId('inline-confirm').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Token revoked')).toBeVisible();
    await expect(section.getByRole('row', { name: /Claude Code \(E2E\)/u })).toContainText('Revoked');
    expect((await initialize(page, secret)).status()).toBe(401);
  } finally {
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
    await ctx.close();
    await adminCtx.close();
  }
});
