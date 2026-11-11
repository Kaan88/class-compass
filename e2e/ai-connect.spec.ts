/**
 * "Connect an AI app" (S19c, D-181). The administrator works through the setup checklist (AI tools on,
 * the documented return hosts in one click; the ticks follow); a teacher walks the ChatGPT path (the
 * friendly "ask your administrator" while chatgpt.com is not allowed, the exact address copied) and the
 * Claude Code path (the copied command, a token made from the page, a real tool call on /mcp, then
 * "Check connection" names it). axe at 1280 and 375 px wide. Every school setting goes back in `finally`.
 * Fictional data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, login, PASSWORD } from './helpers.ts';

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function axeAtWidths(page: Page) {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 800 });
    expect(await seriousViolations(page), `axe at ${width}`).toEqual([]);
    // No sideways scrolling on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no side scroll at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

const rpc = (page: Page, token: string, body: unknown, session?: string) =>
  page.request.post('/mcp', {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(session ? { 'mcp-session-id': session } : {}) },
    data: JSON.stringify(body),
  });

test('Admin → AI tools: the setup checklist ticks as the administrator works through it', async ({ page }) => {
  await login(page, 'admin');
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/ai-tools');
    const list = page.getByTestId('ai-checklist');
    await expect(list.getByRole('heading', { name: 'Setup checklist' })).toBeVisible();
    const item = (id: string) => list.getByTestId(`ai-check-${id}`);
    await expect(item('enabled')).toHaveAttribute('data-status', 'todo');
    await expect(item('enabled')).toContainText('To do');
    await expect(item('host-claude')).toHaveAttribute('data-status', 'done');
    await expect(item('host-chatgpt')).toHaveAttribute('data-status', 'todo');
    await expect(item('student-data')).toContainText('Leave it off until your KVKK contact has agreed');
    await expect(item('access')).toHaveAttribute('data-status', 'manual');
    await expect(item('access')).toContainText('/oauth/token');
    await expect(item('first-call')).toHaveAttribute('data-status', 'todo');
    await axeAtWidths(page);

    await item('enabled').getByRole('button', { name: 'Switch AI tools on' }).click();
    await expect(item('enabled')).toHaveAttribute('data-status', 'done');
    await expect(item('enabled')).toContainText('Done');
    await item('host-chatgpt').getByRole('button', { name: 'Allow chatgpt.com' }).click();
    await expect(page.getByText('chatgpt.com is allowed')).toBeVisible();
    await expect(item('host-chatgpt')).toHaveAttribute('data-status', 'done');
    await expect.poll(async () => (await api(page, 'GET', '/api/admin/ai-tools')).body.redirectHosts).toEqual(['claude.ai', 'chatgpt.com']);
    // The hosts field below shows the new list too.
    await expect(page.getByRole('textbox', { name: 'Hosts' })).toHaveValue('claude.ai\nchatgpt.com');
    await axeAtWidths(page);
    // The audit log names the change.
    await page.goto('/admin/audit');
    await expect(page.getByRole('cell', { name: 'Allowed AI app hosts changed' }).first()).toBeVisible();
  } finally {
    expect((await api(page, 'PUT', '/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai'] })).status).toBe(200);
    expect((await api(page, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
  }
});

test('Profile → AI tools: a teacher walks the ChatGPT and Claude Code paths, copies, and checks the connection', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await login(admin, 'admin');
  try {
    // Off: the teacher is asked to go to the administrator, with what the administrator does.
    await login(page, 'english');
    await page.goto('/teacher/profile');
    const section = page.getByTestId('ai-tools');
    await expect(section.getByTestId('ai-off')).toContainText('Please ask your administrator');
    await expect(section.getByText('Open Admin → AI tools and switch on "AI tools are on".')).toBeVisible();

    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    await page.reload();
    const connect = section.getByTestId('ai-connect');
    await expect(connect.getByRole('heading', { name: 'Connect an AI app' })).toBeVisible();
    // Tokens are under Advanced, closed while the teacher has none.
    await expect(section.getByTestId('ai-advanced')).not.toHaveAttribute('open', '');

    // ChatGPT (chosen first): OAuth, the exact address, and "ask your administrator" until chatgpt.com is allowed.
    await expect(connect.getByTestId('ai-panel')).toHaveAttribute('data-app', 'chatgpt');
    await expect(connect.getByTestId('ai-method')).toContainText('consent page');
    await expect(connect.getByTestId('ai-host-blocked')).toContainText('Ask your administrator to add chatgpt.com');
    const url = (await connect.getByTestId('ai-copy-url-text').innerText()).trim();
    expect(url).toMatch(/^https?:\/\/[^/]+\/mcp$/u);
    await connect.getByTestId('ai-copy-url').click();
    await expect(connect.getByTestId('ai-copy-url')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    await connect.getByRole('button', { name: 'Check connection' }).click();
    await expect(connect.getByTestId('ai-check-result')).toHaveText('No call from ChatGPT yet. Finish the steps, ask it something about your classes, then check again.');
    await axeAtWidths(page);

    expect((await api(admin, 'PUT', '/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai', 'chatgpt.com'] })).status).toBe(200);
    await page.reload();
    await expect(connect.getByTestId('ai-panel')).toBeVisible();
    await expect(connect.getByTestId('ai-host-blocked')).toHaveCount(0);

    // Claude Code: the sign-in command, then a token made from the page and a real tool call.
    await connect.getByTestId('ai-app-claude-code').click();
    await expect(connect.getByTestId('ai-panel')).toHaveAttribute('data-app', 'claude-code');
    await expect(connect.getByTestId('ai-copy-signin-text')).toHaveText(`claude mcp add --transport http class-compass ${url}`);
    await connect.getByTestId('ai-copy-signin').click();
    await expect(connect.getByTestId('ai-copy-signin')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`claude mcp add --transport http class-compass ${url}`);
    await expect(connect.getByTestId('ai-copy-access-text')).toContainText('CF-Access-Client-Id: <id>');
    await axeAtWidths(page);

    await connect.getByRole('button', { name: 'Make a token' }).click();
    const form = page.getByTestId('ai-create-dialog');
    await form.getByLabel('Name', { exact: true }).fill('Claude Code (connect E2E)');
    await form.getByLabel('Current password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Make token' }).click();
    const shown = page.getByTestId('ai-secret-dialog');
    const secret = (await shown.getByTestId('ai-secret').innerText()).trim();
    expect(secret).toMatch(/^ccmcp_/u);
    await expect(shown.getByTestId('ai-command')).toContainText(`claude mcp add --transport http class-compass ${url} --header`);
    await shown.getByRole('button', { name: 'I have stored it' }).click();
    await expect(page.getByText(secret)).toHaveCount(0);

    const init = await rpc(page, secret, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } });
    expect(init.status()).toBe(200);
    const session = init.headers()['mcp-session-id'];
    await rpc(page, secret, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
    const tool = await rpc(page, secret, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_my_classes', arguments: {} } }, session);
    expect(tool.status()).toBe(200);

    await connect.getByRole('button', { name: 'Check connection' }).click();
    const result = connect.getByTestId('ai-check-result');
    await expect(result).toHaveAttribute('data-state', 'ok');
    await expect(result).toContainText('Last tool call from Claude Code: list_my_classes');
    await expect(result).toContainText('your token "Claude Code (connect E2E)"');
    await expect(page.getByText(secret)).toHaveCount(0);

    // Advanced keeps the token list
    // (it opened by itself once the teacher had a working token).
    await expect(section.getByTestId('ai-advanced')).toHaveAttribute('open', '');
    const row = section.getByRole('row', { name: /Claude Code \(connect E2E\)/u });
    await expect(row).toContainText('Active');
    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByTestId('inline-confirm').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Token revoked')).toBeVisible();
    await connect.getByRole('button', { name: 'Check connection' }).click();
    await expect(result).toHaveAttribute('data-state', 'ended');
    await expect(result).toContainText('no longer works');
  } finally {
    // The shared database: no working token of this spec is left behind, even when a step failed.
    const mine = await api(page, 'GET', '/api/account/ai-tools');
    for (const tok of (mine.body?.tokens ?? []) as Array<{ id: string; name: string; status: string }>) {
      if (tok.status === 'active' && tok.name === 'Claude Code (connect E2E)') await api(page, 'POST', `/api/account/ai-tools/tokens/${tok.id}/revoke`);
    }
    expect((await api(admin, 'PUT', '/api/admin/ai-tools/redirect-hosts', { hosts: ['claude.ai'] })).status).toBe(200);
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false })).status).toBe(200);
    await ctx.close();
    await adminCtx.close();
  }
});
